// @ts-nocheck

import { ok, badRequest, forbidden, serverError } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import {
  verifyPayuSignature,
  getPayuOrder,
  summarizeOrder,
} from "backend/payU/payU-client";
import { logInfo, logWarn, logError } from "backend/payU/payU-log";

const SCOPE = "Webhook";

export async function post_payuNotify(request) {
  // Signature is computed over the exact raw body, so read text before parsing.
  const rawBody = await request.body.text();
  // Wix returns header names in lowercase.
  const signatureHeader = request.headers["openpayu-signature"];
  logInfo(SCOPE, "notification received", {
    ip: request.headers["x-forwarded-for"] || request.ip,
    bodyLength: rawBody ? rawBody.length : 0,
  });

  if (!(await verifyPayuSignature(rawBody, signatureHeader))) {
    logError(SCOPE, "rejected (403): invalid signature");
    return forbidden();
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    logError(SCOPE, "rejected (400): body is not JSON", err);
    return badRequest();
  }

  // Refund notifications carry "refund" instead of "order".
  if (body?.refund) {
    logInfo(SCOPE, "refund notification (no Wix update)", {
      orderId: body.orderId,
      extOrderId: body.extOrderId,
      refundId: body.refund.refundId,
      status: body.refund.status,
      amount: body.refund.amount,
      currencyCode: body.refund.currencyCode,
      reason: body.refund.reason,
      reasonDescription: body.refund.reasonDescription,
    });
    return ok();
  }

  const notified = body?.order;
  if (!notified || !notified.extOrderId || !notified.orderId) {
    logError(SCOPE, "rejected (400): missing order.orderId/extOrderId", {
      keys: body ? Object.keys(body) : [],
    });
    return badRequest();
  }
  logInfo(SCOPE, "notified status", {
    orderId: notified.orderId,
    extOrderId: notified.extOrderId,
    status: notified.status,
    localReceiptDateTime: body.localReceiptDateTime,
    properties: body.properties,
  });

  // Never trust the notification body: confirm the status with PayU directly.
  let order;
  try {
    order = await getPayuOrder(notified.orderId);
  } catch (err) {
    logError(SCOPE, "500: could not fetch order from PayU, PayU will retry", err);
    return serverError();
  }

  if (!order || order.extOrderId !== notified.extOrderId) {
    logError(SCOPE, "rejected (400): order not found or extOrderId mismatch", {
      orderId: notified.orderId,
      notifiedExtOrderId: notified.extOrderId,
      payuExtOrderId: order?.extOrderId,
    });
    return badRequest();
  }
  if (order.status !== notified.status) {
    logWarn(SCOPE, "notified status differs from PayU status", {
      orderId: order.orderId,
      notifiedStatus: notified.status,
      payuStatus: order.status,
    });
  }

  const transaction = toWixTransaction(order);
  if (!transaction) {
    return ok();
  }

  try {
    await wixPaymentProviderBackend.submitEvent({ event: { transaction } });
  } catch (err) {
    logError(SCOPE, "500: Wix submitEvent failed, PayU will retry", {
      transaction,
      error: err?.message || String(err),
    });
    return serverError();
  }
  logInfo(SCOPE, "Wix transaction updated", {
    status: order.status,
    transaction,
  });
  return ok();
}

// Maps a PayU order to a Wix transaction event, or null when no update is needed.
function toWixTransaction(order) {
  const summary = summarizeOrder(order);
  const transaction = {
    wixTransactionId: order.extOrderId,
    pluginTransactionId: order.orderId,
  };
  switch (order.status) {
    case "COMPLETED":
      logInfo(SCOPE, "COMPLETED: payment approved", summary);
      return transaction;
    case "CANCELED":
      logWarn(SCOPE, "CANCELED: payment canceled or rejected", summary);
      return {
        ...transaction,
        reasonCode: 3030,
        errorCode: "BUYER_CANCELED",
        errorMessage: "Payment canceled in PayU.",
      };
    case "PENDING":
      logInfo(SCOPE, "PENDING: buyer has not paid yet, no Wix update", summary);
      return null;
    case "WAITING_FOR_CONFIRMATION":
      logWarn(
        SCOPE,
        "WAITING_FOR_CONFIRMATION: funds held, confirm or cancel in PayU panel (auto-receive is off), no Wix update",
        summary,
      );
      return null;
    default:
      logWarn(SCOPE, "unknown status, no Wix update", summary);
      return null;
  }
}
