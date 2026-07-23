// @ts-nocheck
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";

async function getPayuToken() {
  const clientId = await getSecret("PAYU_CLIENT_ID");
  const clientSecret = await getSecret("PAYU_CLIENT_SECRET");

  const response = await fetch(
    "https://secure.payu.com/pl/standard/user/oauth/authorize",
    {
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
    throw new Error("Error OAuth PayU: " + response.status);
  }
  const data = await response.json();
  if (!data.access_token) throw new Error("PayU did not return a token");
  return data.access_token;
}

export async function connectAccount(options) {
  return {
    accountId: options?.credentials?.posId || "payu",
    credentials: options?.credentials || {},
  };
}

export async function createTransaction(options) {
  try {
    const wixTransactionId = options?.wixTransactionId;
    const order = options?.order;

    if (!wixTransactionId || !order) {
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No transaction data",
      };
    }

    const items = order.description?.items || [];
    const totalAmount = order.description?.totalAmount || 0;

    if (items.length === 0) {
      return {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "No products in the order",
      };
    }

    const posId = await getSecret("PAYU_POS_ID");
    const token = await getPayuToken();

    const payuOrder = {
      notifyUrl: "https://www.kulikstyle.com/_functions/payuNotify",
      continueUrl: "https://www.kulikstyle.com/thank-you-page",
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

    const response = await fetch("https://secure.payu.com/api/v2_1/orders/", {
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
