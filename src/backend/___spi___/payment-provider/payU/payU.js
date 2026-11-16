// @ts-nocheck
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import {
  isTest,
  PayUTestClientId,
  PayUTestPointOfSalesId,
  PayUTestClientSecret,
  PayUAuthUrl,
  PayUOrdersUrl,
  PayUNotifyUrl,
  getPayUContinueUrl,
} from './payU-env';

async function getClientId() {
  if (isTest()) {
    return PayUTestClientId;
  }
  return await getSecret("PAYU_CLIENT_ID");
}

async function getClientSecret() {
  if (isTest()) {
    return PayUTestClientSecret;
  }
  return await getSecret("PAYU_CLIENT_SECRET");
}

async function getPayuToken() {
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
    },
  );

  if (!response.ok) {
    console.error("PayU get token - response error: " + response);
    throw new Error("Error OAuth PayU: " + response.status);
  }
  const data = await response.json();
  if (!data.access_token) { 
    console.error("PayU get token - no token provided: " + data);
    throw new Error("PayU did not return a token");
  }
  console.debug("PayU get token - success");
  return data.access_token;
}

export async function connectAccount(options) {
  console.debug("PayU connect account");
  return {
    accountId: options?.credentials?.payUPosId || "payu",
    credentials: options?.credentials || {},
  };
}

export async function createTransaction(options) {
  console.debug("PayU create transaction - start");
  try {
    const wixTransactionId = options?.wixTransactionId;
    const order = options?.order;

    if (!wixTransactionId || !order) {
      console.warn("PayU get token - no wix transaction id");
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No transaction data",
      };
    }

    const items = order.description?.items || [];
    const totalAmount = order.description?.totalAmount || 0;

    if (items.length === 0) {
      console.warn("PayU get token - no products in the order");
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No products in the order",
      };
    }

    const posId = PayUTestPointOfSalesId; // await getSecret("PAYU_POS_ID");
    const token = await getPayuToken();

    const payuOrder = {
      notifyUrl: PayUNotifyUrl,
      continueUrl: getPayUCContinueUrl(order._orderId),
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
    console.debug("PayU get token - success: " + data.orderId);

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
