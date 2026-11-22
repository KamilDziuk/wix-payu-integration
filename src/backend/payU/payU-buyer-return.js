// @ts-nocheck
// Handles the buyer coming back from PayU (GET /_functions/payuReturn).
//
// continueUrl: /_functions/payuReturn?tx=<wixTransactionId>&s=..&e=..&p=..&c=..&sig=..
// PayU may append error=501 when the payment failed.
//
// Flow:
//   1. Read and verify the signed return parameters.
//   2. Ask PayU for the order status, rechecking briefly while payment is in progress.
//   3. Redirect the buyer to the Wix page for that status (see pickReturnTarget).
import { response } from "wix-http-functions";
import { getPayuOrderByExtId } from "backend/payU/payU-client";
import {
  readReturnParams,
  pickReturnTarget,
  resolveReturnUrl,
} from "backend/payU/payU-return";
import { isAwaitingPayment } from "backend/payU/payU-order-status";
import { getPayUContinueUrl } from "backend/payU/payU-env";
import { logInfo, logWarn, logError, describeError } from "backend/payU/payU-log";

const LOG_SCOPE = "Return";
// BLIK and card payments often settle a few seconds after the buyer returns.
const PAYMENT_RECHECK_ATTEMPTS = 2;
const PAYMENT_RECHECK_DELAY_MILLISECONDS = 1500;

export async function handleBuyerReturnFromPayu(request) {
  const payuFailureCode = request.query?.error;
  const returnParameters = await readReturnParams(request.query);
  const wixTransactionId = returnParameters?.tx;
  logInfo(LOG_SCOPE, "buyer returned from PayU", { tx: wixTransactionId, error: payuFailureCode });

  if (!returnParameters?.valid) {
    logWarn(LOG_SCOPE, "missing or invalid signed parameters, redirecting to fallback page", {
      tx: wixTransactionId,
    });
    return redirectBuyerTo(getPayUContinueUrl());
  }

  // When PayU already reported a failure there is nothing to wait for.
  const orderStatus = await findOrderStatus(wixTransactionId, {
    waitWhileAwaitingPayment: !payuFailureCode,
  });

  const returnPage = pickReturnTarget(orderStatus, payuFailureCode);
  const { url, field } = resolveReturnUrl(returnParameters.urls, returnPage);
  logInfo(LOG_SCOPE, "redirecting buyer", {
    tx: wixTransactionId,
    status: orderStatus,
    error: payuFailureCode,
    target: returnPage,
    used: field,
  });
  return redirectBuyerTo(url);
}

// Returns the PayU order status, or null when it cannot be read.
async function findOrderStatus(wixTransactionId, { waitWhileAwaitingPayment }) {
  try {
    return await fetchOrderStatusWithRechecks(wixTransactionId, waitWhileAwaitingPayment);
  } catch (error) {
    logError(LOG_SCOPE, "could not fetch order status", {
      tx: wixTransactionId,
      error: describeError(error),
    });
    return null;
  }
}

async function fetchOrderStatusWithRechecks(wixTransactionId, waitWhileAwaitingPayment) {
  for (let recheck = 0; ; recheck++) {
    const order = await getPayuOrderByExtId(wixTransactionId);
    const status = order?.status || null;
    const shouldRecheck =
      waitWhileAwaitingPayment &&
      isAwaitingPayment(status) &&
      recheck < PAYMENT_RECHECK_ATTEMPTS;
    if (!shouldRecheck) {
      return status;
    }
    await wait(PAYMENT_RECHECK_DELAY_MILLISECONDS);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redirectBuyerTo(url) {
  return response({
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
