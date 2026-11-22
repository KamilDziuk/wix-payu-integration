// @ts-nocheck
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import CryptoJS from "crypto-js";
import {
  isTest,
  PayUTestClientId,
  PayUTestClientSecret,
  PayUTestSecondKey,
  PayUAuthUrl,
  PayUOrdersUrl,
} from "backend/payU/payU-env";
import { logInfo, logWarn, logError } from "backend/payU/payU-log";

async function getClientId() {
  return isTest() ? PayUTestClientId : await getSecret("PAYU_CLIENT_ID");
}

async function getClientSecret() {
  return isTest() ? PayUTestClientSecret : await getSecret("PAYU_CLIENT_SECRET");
}

async function getSecondKey() {
  return isTest() ? PayUTestSecondKey : await getSecret("PAYU_SECOND_KEY");
}

// Reads a response body as JSON, keeping the raw text when it is not JSON
// (PayU returns HTML error pages for some failures).
export async function readResponse(response) {
  const text = await response.text();
  try {
    return { data: JSON.parse(text), text };
  } catch (_err) {
    return { data: null, text: text ? text.slice(0, 1000) : "" };
  }
}

// PayU order fields worth logging, without buyer personal data.
export function summarizeOrder(order) {
  if (!order) {
    return null;
  }
  return {
    orderId: order.orderId,
    extOrderId: order.extOrderId,
    status: order.status,
    totalAmount: order.totalAmount,
    currencyCode: order.currencyCode,
    payMethod: order.payMethod?.type,
    orderCreateDate: order.orderCreateDate,
    localReceiptDateTime: order.localReceiptDateTime,
  };
}

export async function getPayuToken() {
  const clientId = await getClientId();
  const clientSecret = await getClientSecret();
  if (!clientId || !clientSecret) {
    logError("Token", "client ID or secret not configured", {
      test: isTest(),
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
    });
    throw new Error("PayU client credentials not configured");
  }

  const response = await fetch(PayUAuthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=client_credentials" +
      "&client_id=" +
      encodeURIComponent(clientId) +
      "&client_secret=" +
      encodeURIComponent(clientSecret),
  });
  const { data, text } = await readResponse(response);

  if (!response.ok) {
    logError("Token", "OAuth request failed", {
      httpStatus: response.status,
      error: data?.error,
      errorDescription: data?.error_description,
      body: data ? undefined : text,
    });
    throw new Error("PayU OAuth error: " + response.status);
  }
  if (!data?.access_token) {
    logError("Token", "no access_token in response", {
      httpStatus: response.status,
      body: text,
    });
    throw new Error("PayU did not return a token");
  }
  logInfo("Token", "obtained", {
    clientId,
    expiresIn: data.expires_in,
    grantType: data.grant_type,
  });
  return data.access_token;
}

// Returns the PayU order, or null if PayU does not know it.
export async function getPayuOrder(orderId) {
  const token = await getPayuToken();
  const response = await fetch(PayUOrdersUrl + encodeURIComponent(orderId), {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });
  const { data, text } = await readResponse(response);

  if (response.status === 404) {
    logWarn("Order", "not found in PayU", { orderId, status: data?.status });
    return null;
  }
  if (!response.ok) {
    logError("Order", "fetch failed", {
      orderId,
      httpStatus: response.status,
      status: data?.status,
      body: data ? undefined : text,
    });
    throw new Error("PayU get order - response error: " + response.status);
  }

  const order = data?.orders?.[0] || null;
  logInfo("Order", "fetched", {
    responseStatus: data?.status?.statusCode,
    order: summarizeOrder(order),
    properties: data?.properties,
  });
  return order;
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Header: "sender=checkout;signature=...;algorithm=MD5;content=DOCUMENT"
// Expected signature: hash(rawBody + secondKey)
export async function verifyPayuSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
    logWarn("Signature", "missing OpenPayu-Signature header");
    return false;
  }
  const parts = {};
  String(signatureHeader)
    .split(";")
    .forEach(function (pair) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        parts[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
      }
    });
  if (!parts.signature) {
    logWarn("Signature", "no signature in header", {
      sender: parts.sender,
      algorithm: parts.algorithm,
    });
    return false;
  }

  const secondKey = await getSecondKey();
  if (!secondKey) {
    logError("Signature", "second key not configured (PAYU_SECOND_KEY)", {
      test: isTest(),
    });
    return false;
  }

  const algorithm = (parts.algorithm || "MD5").toUpperCase().replace("-", "");
  let expected;
  if (algorithm === "MD5") {
    expected = CryptoJS.MD5(rawBody + secondKey).toString();
  } else if (algorithm === "SHA256") {
    expected = CryptoJS.SHA256(rawBody + secondKey).toString();
  } else {
    logError("Signature", "unsupported algorithm", { algorithm });
    return false;
  }

  const valid = safeEqual(parts.signature.toLowerCase(), expected);
  if (!valid) {
    logWarn("Signature", "mismatch - wrong second key or forged request", {
      sender: parts.sender,
      algorithm,
      test: isTest(),
    });
  }
  return valid;
}
