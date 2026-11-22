// @ts-nocheck
// Handles PayU payment notifications (POST /_functions/payuNotify).
//
// Flow:
//   1. Check the notification is signed by PayU.
//   2. Read the notification body.
//   3. Acknowledge refund notifications (no Wix update).
//   4. Confirm the order and its status with PayU directly.
//   5. Run the flow for that status.
//
// PayU retries any notification not answered with 200, for up to 72 hours,
// so 500 is used only when retrying can help.
import { ok, badRequest, forbidden, serverError } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import {
  verifyPayuSignature,
  getPayuOrder,
  summarizeOrder,
} from "backend/payU/payU-client";
import { PayUOrderStatus } from "backend/payU/payU-order-status";
import { logInfo, logWarn, logError, describeError } from "backend/payU/payU-log";

const LOG_SCOPE = "Webhook";
// Wix reason code for a payment the buyer canceled.
const WIX_BUYER_CANCELED_REASON_CODE = 3030;

// What happens for each PayU order status.
const notificationFlowByStatus = {
  [PayUOrderStatus.COMPLETED]: approveWixTransaction,
  [PayUOrderStatus.CANCELED]: cancelWixTransaction,
  [PayUOrderStatus.WAITING_FOR_CONFIRMATION]: waitForMerchantConfirmation,
  [PayUOrderStatus.PENDING]: waitForBuyerPayment,
  [PayUOrderStatus.NEW]: waitForBuyerPayment,
};

export async function handlePayuNotification(request) {
  // The signature covers the exact raw body, so read it before parsing.
  const rawBody = await request.body.text();
  logNotificationReceived(request, rawBody);

  if (!(await isSignedByPayu(request, rawBody))) {
    return rejectAsForbidden("invalid signature");
  }

  const notification = parseNotification(rawBody);
  if (!notification.isJson) {
    return rejectAsBadRequest("body is not JSON", notification.parseError);
  }
  const body = notification.body;

  if (isRefundNotification(body)) {
    return acknowledgeRefundNotification(body);
  }

  const notifiedOrder = body?.order;
  if (!hasOrderIdentifiers(notifiedOrder)) {
    return rejectAsBadRequest("missing order.orderId/extOrderId", {
      keys: body ? Object.keys(body) : [],
    });
  }
  logNotifiedStatus(body, notifiedOrder);

  // Never trust the notification body: confirm the order with PayU directly.
  let confirmedOrder;
  try {
    confirmedOrder = await getPayuOrder(notifiedOrder.orderId);
  } catch (error) {
    return askPayuToRetry("could not fetch order from PayU", { error: describeError(error) });
  }
  if (!isSameOrder(confirmedOrder, notifiedOrder)) {
    return rejectAsBadRequest("order not found or extOrderId mismatch", {
      orderId: notifiedOrder.orderId,
      notifiedExtOrderId: notifiedOrder.extOrderId,
      payuExtOrderId: confirmedOrder?.extOrderId,
    });
  }
  warnIfStatusChanged(notifiedOrder, confirmedOrder);

  const statusFlow = notificationFlowByStatus[confirmedOrder.status] || ignoreUnknownStatus;
  return statusFlow(confirmedOrder);
}

// ---- Status flows ----

function approveWixTransaction(order) {
  logInfo(LOG_SCOPE, "COMPLETED: payment approved", summarizeOrder(order));
  return updateWixTransaction(order, wixTransactionFor(order));
}

function cancelWixTransaction(order) {
  logWarn(LOG_SCOPE, "CANCELED: payment canceled or rejected", summarizeOrder(order));
  return updateWixTransaction(order, {
    ...wixTransactionFor(order),
    reasonCode: WIX_BUYER_CANCELED_REASON_CODE,
    errorCode: "BUYER_CANCELED",
    errorMessage: "Payment canceled in PayU.",
  });
}

function waitForMerchantConfirmation(order) {
  logWarn(
    LOG_SCOPE,
    "WAITING_FOR_CONFIRMATION: funds held, confirm or cancel in PayU panel (auto-receive is off), no Wix update",
    summarizeOrder(order),
  );
  return acknowledge();
}

function waitForBuyerPayment(order) {
  // The Wix transaction is already pending until PayU reports a final status.
  logInfo(LOG_SCOPE, order.status + ": buyer has not paid yet, no Wix update", summarizeOrder(order));
  return acknowledge();
}

function ignoreUnknownStatus(order) {
  logWarn(LOG_SCOPE, "unknown status, no Wix update", summarizeOrder(order));
  return acknowledge();
}

function acknowledgeRefundNotification(body) {
  logInfo(LOG_SCOPE, "refund notification (no Wix update)", {
    orderId: body.orderId,
    extOrderId: body.extOrderId,
    refundId: body.refund.refundId,
    status: body.refund.status,
    amount: body.refund.amount,
    currencyCode: body.refund.currencyCode,
    reason: body.refund.reason,
    reasonDescription: body.refund.reasonDescription,
  });
  return acknowledge();
}

// ---- Wix update ----

function wixTransactionFor(order) {
  return {
    wixTransactionId: order.extOrderId,
    pluginTransactionId: order.orderId,
  };
}

async function updateWixTransaction(order, transaction) {
  try {
    await wixPaymentProviderBackend.submitEvent({ event: { transaction } });
  } catch (error) {
    return askPayuToRetry("Wix submitEvent failed", {
      transaction,
      error: describeError(error),
    });
  }
  logInfo(LOG_SCOPE, "Wix transaction updated", { status: order.status, transaction });
  return acknowledge();
}

// ---- Checks ----

function isSignedByPayu(request, rawBody) {
  // Wix passes header names in lowercase.
  return verifyPayuSignature(rawBody, request.headers["openpayu-signature"]);
}

function parseNotification(rawBody) {
  try {
    return { isJson: true, body: JSON.parse(rawBody) };
  } catch (error) {
    return { isJson: false, parseError: error };
  }
}

function isRefundNotification(body) {
  // Refund notifications carry "refund" instead of "order".
  return Boolean(body?.refund);
}

function hasOrderIdentifiers(order) {
  return Boolean(order?.orderId && order?.extOrderId);
}

function isSameOrder(confirmedOrder, notifiedOrder) {
  return Boolean(confirmedOrder) && confirmedOrder.extOrderId === notifiedOrder.extOrderId;
}

// ---- Logging ----

function logNotificationReceived(request, rawBody) {
  logInfo(LOG_SCOPE, "notification received", {
    ip: request.headers["x-forwarded-for"] || request.ip,
    bodyLength: rawBody ? rawBody.length : 0,
  });
}

function logNotifiedStatus(body, notifiedOrder) {
  logInfo(LOG_SCOPE, "notified status", {
    orderId: notifiedOrder.orderId,
    extOrderId: notifiedOrder.extOrderId,
    status: notifiedOrder.status,
    localReceiptDateTime: body.localReceiptDateTime,
    properties: body.properties,
  });
}

function warnIfStatusChanged(notifiedOrder, confirmedOrder) {
  if (confirmedOrder.status !== notifiedOrder.status) {
    logWarn(LOG_SCOPE, "notified status differs from PayU status", {
      orderId: confirmedOrder.orderId,
      notifiedStatus: notifiedOrder.status,
      payuStatus: confirmedOrder.status,
    });
  }
}

// ---- Responses to PayU ----

function acknowledge() {
  return ok();
}

function rejectAsForbidden(reason) {
  logError(LOG_SCOPE, "rejected (403): " + reason);
  return forbidden();
}

function rejectAsBadRequest(reason, details) {
  logError(LOG_SCOPE, "rejected (400): " + reason, details);
  return badRequest();
}

function askPayuToRetry(reason, details) {
  logError(LOG_SCOPE, "500: " + reason + ", PayU will retry", details);
  return serverError();
}
