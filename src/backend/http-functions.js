// @ts-nocheck

import { ok, badRequest, forbidden } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import { getSecret } from "wix-secrets-backend";
import * as CryptoJS from "crypto-js";

function verifyPayuSignature(rawBody, signatureHeader, secondKey) {
  if (!signatureHeader) return false;

  const parts = {};

  signatureHeader.split(";").forEach(function (pair) {
    const [key, value] = pair.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  });

  const algorithm = (parts.algorithm || "MD5").toUpperCase();

  const expectedSignature =
    algorithm === "SHA256"
      ? CryptoJS.SHA256(rawBody + secondKey).toString()
      : CryptoJS.MD5(rawBody + secondKey).toString();

  return parts.signature === expectedSignature;
}

export async function post_payuNotify(request) {
  const rawBody = await request.body.text();

  const signatureHeader = request.headers["openpayu-signature"];

  const secondKey = await getSecret("PAYU_SECOND_KEY");

  const isValid = verifyPayuSignature(rawBody, signatureHeader, secondKey);

  if (!isValid) {
    console.error(
      "[PayU Webhook] Invalid signature - request rejected. Possible attempt to forge the notification.",
    );

    return forbidden();
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error(
      "[PayU Webhook] Signature valid, but content is not valid JSON:",
      err,
    );

    return badRequest();
  }

  const order = body?.order;

  if (!order || !order.extOrderId || !order.orderId) {
    console.error(
      "[PayU Webhook] Missing required fields in notification:",
      body,
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
      console.error(
        "[PayU Webhook] Signature verified. Status other than COMPLETED:",
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
