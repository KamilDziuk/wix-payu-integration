// @ts-nocheck

import { ok, badRequest, forbidden, serverError } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import CryptoJS from "crypto-js";

// NOTE: duplicated from backend/___spi___/payment-provider/payU (payU-env.js, payU.js),
// since http-functions cannot import from the plugin folder. Keep both in sync.
const PayUEnvironment = "test"; // or 'prod'
const PayUTestClientId = "145227";
const PayUTestClientSecret = "12f071174cb7eb79d4aac5bc2f07563f";
const PayUTestSecondKey = "13a980d4f851f3d9a1cfc792fb1f5e50";
const PayUAuthUrl = "https://secure.payu.com/pl/standard/user/oauth/authorize";
const PayUOrdersUrl = "https://secure.payu.com/api/v2_1/orders/";

function isTest() {
  return PayUEnvironment === "test";
}

async function getClientId() {
  return isTest() ? PayUTestClientId : await getSecret("PAYU_CLIENT_ID");
}

async function getClientSecret() {
  return isTest() ? PayUTestClientSecret : await getSecret("PAYU_CLIENT_SECRET");
}

async function getSecondKey() {
  return isTest() ? PayUTestSecondKey : await getSecret("PAYU_SECOND_KEY");
}

async function getPayuToken() {
  const clientId = await getClientId();
  const clientSecret = await getClientSecret();

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

  if (!response.ok) {
    throw new Error("Error OAuth PayU: " + response.status);
  }
  const data = await response.json();
  if (!data.access_token) {
    throw new Error("PayU did not return a token");
  }
  return data.access_token;
}

// Returns the PayU order, or null if PayU does not know it.
async function getPayuOrder(orderId) {
  const token = await getPayuToken();
  const response = await fetch(PayUOrdersUrl + encodeURIComponent(orderId), {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("PayU get order - response error: " + response.status);
  }
  const data = await response.json();
  return data?.orders?.[0] || null;
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
async function verifyPayuSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
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
    return false;
  }

  const secondKey = await getSecondKey();
  if (!secondKey) {
    console.error("[PayU Webhook] Second key not configured");
    return false;
  }

  const algorithm = (parts.algorithm || "MD5").toUpperCase().replace("-", "");
  let expected;
  if (algorithm === "MD5") {
    expected = CryptoJS.MD5(rawBody + secondKey).toString();
  } else if (algorithm === "SHA256") {
    expected = CryptoJS.SHA256(rawBody + secondKey).toString();
  } else {
    console.error("[PayU Webhook] Unsupported signature algorithm: " + algorithm);
    return false;
  }

  return safeEqual(parts.signature.toLowerCase(), expected);
}

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

  try {
    if (order.status === "COMPLETED") {
      await wixPaymentProviderBackend.submitEvent({
        event: {
          transaction: {
            wixTransactionId: order.extOrderId,
            pluginTransactionId: order.orderId,
          },
        },
      });
    } else {
      console.log(
        "[PayU Webhook] Status:",
        order.status,
        "| extOrderId:",
        order.extOrderId,
      );
    }
  } catch (err) {
    console.error("[PayU Webhook] submitEvent error:", err);
  }
  return ok();
}
