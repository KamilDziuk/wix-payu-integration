// @ts-nocheck
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import {
  PayUEnabled,
  isTest,
  PayUTestPointOfSalesId,
  PayUOrdersUrl,
  PayUNotifyUrl,
  getPayUContinueUrl,
} from 'backend/payU/payU-env';
import { getPayuToken } from 'backend/payU/payU-client';

export async function connectAccount(options) {
  console.debug("PayU connect account");
  return {
    accountId: options?.credentials?.payUPosId || "payu",
    credentials: options?.credentials || {},
  };
}

async function getPosId(merchantCredentials) {
  if (isTest()) {
    return PayUTestPointOfSalesId;
  }
  return merchantCredentials?.payUPosId || (await getSecret("PAYU_POS_ID"));
}

export async function createTransaction(options) {
  console.debug("PayU create transaction - start");
  if (!PayUEnabled) {
    console.warn("PayU create transaction - plugin disabled");
    return {
      errorCode: "PROVIDER_ERROR",
      errorMessage: "PayU payments are disabled",
    };
  }
  try {
    const wixTransactionId = options?.wixTransactionId;
    const order = options?.order;

    if (!wixTransactionId || !order) {
      console.warn("PayU create transaction - no transaction data");
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No transaction data",
      };
    }

    const items = order.description?.items || [];
    const totalAmount = order.description?.totalAmount || 0;

    if (items.length === 0) {
      console.warn("PayU create transaction - no products in the order");
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No products in the order",
      };
    }

    const posId = await getPosId(options?.merchantCredentials);
    if (!posId) {
      console.error("PayU create transaction - POS ID not configured");
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "PayU POS ID not configured",
      };
    }
    const token = await getPayuToken();

    const payuOrder = {
      notifyUrl: PayUNotifyUrl,
      continueUrl: order.returnUrls?.successUrl || getPayUContinueUrl(order._id),
      merchantPosId: posId,
      customerIp: options?.fraudInformation?.remoteIp || "127.0.0.1",
      extOrderId: wixTransactionId,
      description: "Zamówienie " + wixTransactionId,
      currencyCode: order.description?.currency || "PLN",
      totalAmount: String(totalAmount),
      products: items.map(function (item) {
        return {
          name: item.name || "Produkt",
          unitPrice: String(item.price),
          quantity: Number(item.quantity || 1),
        };
      }),
    };

    const response = await fetch(PayUOrdersUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payuOrder),
      redirect: "manual",
    });

    const data = await response.json();

    if (!data.redirectUri || !data.orderId) {
      console.error("[PayU] Lack redirectUri/orderId:", data);
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage:
          "No payment link from PayU. Status:" +
          (data?.status?.statusCode || response.status),
      };
    }
    console.debug("PayU create transaction - success: " + data.orderId);

    return {
      pluginTransactionId: data.orderId,
      redirectUrl: data.redirectUri,
    };
  } catch (err) {
    console.error("[PayU] Error:", err);
    return {
      errorCode: "PROVIDER_ERROR",
      errorMessage: err && err.message ? err.message : String(err),
    };
  }
}

export async function refundTransaction(_options) {
  return {
    errorCode: "PROVIDER_ERROR",
    errorMessage: "Make refunds manually in the PayU panel.",
  };
}
