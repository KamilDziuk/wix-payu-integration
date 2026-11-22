// @ts-nocheck
// PayU accepts a single continueUrl, so the buyer returns to payuReturn,
// which picks the Wix return page by PayU order status. The Wix return URLs
// travel in the continueUrl itself (no storage), signed to prevent open
// redirects.
import { PayUReturnUrl, getPayUContinueUrl } from "backend/payU/payU-env";
import { signValue, verifySignedValue } from "backend/payU/payU-client";
import { logWarn } from "backend/payU/payU-log";
import { PayUOrderStatus, hasBuyerPaid } from "backend/payU/payU-order-status";

const MAX_URL_LENGTH = 1024; // PayU continueUrl limit

// Query key -> Wix returnUrls field.
const URL_PARAMS = {
  s: "successUrl",
  e: "errorUrl",
  p: "pendingUrl",
  c: "cancelUrl",
};
// Dropped first when the continueUrl is too long; fallbacks cover them.
const DROP_ORDER = ["c", "p", "e"];

function canonical(tx, urls) {
  return [tx]
    .concat(Object.keys(URL_PARAMS).map((key) => urls[key] || ""))
    .join("\n");
}

async function compose(tx, urls) {
  let url = PayUReturnUrl + "?tx=" + encodeURIComponent(tx);
  for (const key of Object.keys(URL_PARAMS)) {
    if (urls[key]) {
      url += "&" + key + "=" + encodeURIComponent(urls[key]);
    }
  }
  return url + "&sig=" + (await signValue(canonical(tx, urls)));
}

export async function buildContinueUrl(wixTransactionId, returnUrls) {
  const urls = {};
  for (const [key, field] of Object.entries(URL_PARAMS)) {
    if (returnUrls?.[field]) {
      urls[key] = returnUrls[field];
    }
  }

  let url = await compose(wixTransactionId, urls);
  for (const key of DROP_ORDER) {
    if (url.length <= MAX_URL_LENGTH) {
      break;
    }
    if (urls[key]) {
      delete urls[key];
      logWarn("Return", "continueUrl too long, dropped " + URL_PARAMS[key], {
        wixTransactionId,
      });
      url = await compose(wixTransactionId, urls);
    }
  }
  if (url.length > MAX_URL_LENGTH) {
    logWarn("Return", "continueUrl too long, using Wix successUrl directly", {
      wixTransactionId,
      length: url.length,
    });
    const successUrl = returnUrls?.successUrl;
    return successUrl && successUrl.length <= MAX_URL_LENGTH
      ? successUrl
      : getPayUContinueUrl();
  }
  return url;
}

// Returns { tx, valid, urls } from the payuReturn query, or null without tx.
export async function readReturnParams(query) {
  const tx = query?.tx;
  if (!tx) {
    return null;
  }
  const urls = {};
  for (const key of Object.keys(URL_PARAMS)) {
    if (query[key]) {
      urls[key] = query[key];
    }
  }
  const valid = await verifySignedValue(canonical(tx, urls), query.sig);
  const returnUrls = {};
  for (const [key, field] of Object.entries(URL_PARAMS)) {
    returnUrls[field] = urls[key];
  }
  return { tx, valid, urls: returnUrls };
}

// Wix page the buyer is sent to for each PayU order status.
const returnPageByStatus = {
  [PayUOrderStatus.COMPLETED]: "successUrl",
  [PayUOrderStatus.WAITING_FOR_CONFIRMATION]: "successUrl",
  [PayUOrderStatus.CANCELED]: "cancelUrl",
  [PayUOrderStatus.NEW]: "pendingUrl",
  [PayUOrderStatus.PENDING]: "pendingUrl",
};
// Unknown status or failed lookup: claim neither success nor failure.
const returnPageForUnknownStatus = "pendingUrl";

// Returns the name of the Wix return URL to use.
export function pickReturnTarget(status, payuReportedFailure) {
  if (payuReportedFailure && !hasBuyerPaid(status)) {
    return "errorUrl";
  }
  return returnPageByStatus[status] || returnPageForUnknownStatus;
}

const FALLBACKS = {
  successUrl: ["successUrl"],
  pendingUrl: ["pendingUrl", "successUrl"],
  cancelUrl: ["cancelUrl", "errorUrl"],
  errorUrl: ["errorUrl", "cancelUrl"],
};

export function resolveReturnUrl(urls, target) {
  for (const field of FALLBACKS[target]) {
    if (urls?.[field]) {
      return { url: urls[field], field };
    }
  }
  return { url: getPayUContinueUrl(), field: "fallback" };
}
