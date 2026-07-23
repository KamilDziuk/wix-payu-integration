// @ts-nocheck

import { ok, badRequest } from "wix-http-functions";
import wixPaymentProviderBackend from "wix-payment-provider-backend";

export async function post_payuNotify(request) {
  let body;
  try {
    body = await request.body.json();
  } catch (err) {
    console.error("payuNotify: incorrect JSON", err);
    return badRequest();
  }

  const order = body?.order;
  if (!order || !order.extOrderId || !order.orderId) {
    console.error("payuNotify: missing required fields", body);
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
