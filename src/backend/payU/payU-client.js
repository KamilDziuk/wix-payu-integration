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

async function getClientId() {
  return isTest() ? PayUTestClientId : await getSecret("PAYU_CLIENT_ID");
}

async function getClientSecret() {
  return isTest() ? PayUTestClientSecret : await getSecret("PAYU_CLIENT_SECRET");
}

async function getSecondKey() {
  return isTest() ? PayUTestSecondKey : await getSecret("PAYU_SECOND_KEY");
}

export async function getPayuToken() {
  console.debug("PayU get token - start");
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
    console.error("PayU get token - response error: " + response.status);
    throw new Error("Error OAuth PayU: " + response.status);
  }
  const data = await response.json();
  if (!data.access_token) {
    console.error("PayU get token - no token provided");
    throw new Error("PayU did not return a token");
  }
  console.debug("PayU get token - success");
  return data.access_token;
}

// Returns the PayU order, or null if PayU does not know it.
export async function getPayuOrder(orderId) {
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
export async function verifyPayuSignature(rawBody, signatureHeader) {
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
    console.error("PayU verify signature - second key not configured");
    return false;
  }

  const algorithm = (parts.algorithm || "MD5").toUpperCase().replace("-", "");
  let expected;
  if (algorithm === "MD5") {
    expected = CryptoJS.MD5(rawBody + secondKey).toString();
  } else if (algorithm === "SHA256") {
    expected = CryptoJS.SHA256(rawBody + secondKey).toString();
  } else {
    console.error("PayU verify signature - unsupported algorithm: " + algorithm);
    return false;
  }

  return safeEqual(parts.signature.toLowerCase(), expected);
}
