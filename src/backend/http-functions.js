// @ts-nocheck

import { ok, badRequest, forbidden, serverError } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import {
  verifyPayuSignature,
  getPayuOrder,
} from "backend/payU/payU-client";

export async function post_payuNotify(request) {
  // Signature is computed over the exact raw body, so read text before parsing.
  const rawBody = await request.body.text();
  // Wix returns header names in lowercase.
  const signatureHeader = request.headers["openpayu-signature"];

  if (!(await verifyPayuSignature(rawBody, signatureHeader))) {
    console.error("[PayU Webhook] Invalid signature - request rejected");
    return forbidden();
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error("[PayU Webhook] Incorrect JSON", err);
    return badRequest();
  }

  const notified = body?.order;
  if (!notified || !notified.extOrderId || !notified.orderId) {
    console.error("[PayU Webhook] Missing required fields");
    return badRequest();
  }

  // Never trust the notification body: confirm the status with PayU directly.
  let order;
  try {
    order = await getPayuOrder(notified.orderId);
  } catch (err) {
    console.error("[PayU Webhook] Could not fetch order from PayU:", err);
    return serverError(); // PayU will retry the notification
  }

  if (!order || order.extOrderId !== notified.extOrderId) {
    console.error(
      "[PayU Webhook] Order not found or extOrderId mismatch | orderId:",
      notified.orderId,
    );
    return badRequest();
  }

  const transaction = toWixTransaction(order);
  if (!transaction) {
    // PENDING / WAITING_FOR_CONFIRMATION: Wix transaction is already pending.
    console.log(
      "[PayU Webhook] Status:",
      order.status,
      "| extOrderId:",
      order.extOrderId,
    );
    return ok();
  }

  try {
    await wixPaymentProviderBackend.submitEvent({ event: { transaction } });
  } catch (err) {
    console.error("[PayU Webhook] submitEvent error:", err);
    return serverError(); // PayU will retry the notification
  }
  return ok();
}

// Maps a PayU order to a Wix transaction event, or null when no update is needed.
function toWixTransaction(order) {
  const transaction = {
    wixTransactionId: order.extOrderId,
    pluginTransactionId: order.orderId,
  };
  switch (order.status) {
    case "COMPLETED":
      return transaction;
    case "CANCELED":
      return {
        ...transaction,
        reasonCode: 3030,
        errorCode: "BUYER_CANCELED",
        errorMessage: "Payment canceled in PayU.",
      };
    default:
      return null;
  }
}
