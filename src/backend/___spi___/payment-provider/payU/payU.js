// @ts-nocheck
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import {
  PayUEnabled,
  isTest,
  PayUTestPointOfSalesId,
  PayUOrdersUrl,
  PayUNotifyUrl,
} from 'backend/payU/payU-env';
import { getPayuToken, readResponse } from 'backend/payU/payU-client';
import { buildContinueUrl } from 'backend/payU/payU-return';
import { logInfo, logWarn, logError } from 'backend/payU/payU-log';

export async function connectAccount(options) {
  const accountId = options?.credentials?.payUPosId || "payu";
  logInfo("Connect", "account connected", {
    accountId,
    hasPosId: !!options?.credentials?.payUPosId,
  });
  return {
    accountId,
    credentials: options?.credentials || {},
  };
}

async function getPosId(merchantCredentials) {
  if (isTest()) {
    return PayUTestPointOfSalesId;
  }
  return merchantCredentials?.payUPosId || (await getSecret("PAYU_POS_ID"));
}

function providerError(message, details) {
  logError("Create", "failed: " + message, details);
  return { errorCode: "PROVIDER_ERROR", errorMessage: message };
}

export async function createTransaction(options) {
  const wixTransactionId = options?.wixTransactionId;
  const order = options?.order;
  const items = order?.description?.items || [];
  const totalAmount = order?.description?.totalAmount || 0;
  const context = {
    wixTransactionId,
    wixOrderId: order?._id,
    totalAmount,
    currency: order?.description?.currency,
    itemCount: items.length,
    test: isTest(),
  };
  logInfo("Create", "start", context);

  if (!PayUEnabled) {
    return providerError("PayU payments are disabled", context);
  }
  try {
    if (!wixTransactionId || !order) {
      return providerError("No transaction data", context);
    }
    if (items.length === 0) {
      return providerError("No products in the order", context);
    }

    const posId = await getPosId(options?.merchantCredentials);
    if (!posId) {
      return providerError("PayU POS ID not configured", context);
    }
    const token = await getPayuToken();

    // PayU has a single return URL; payuReturn picks the Wix page by status.
    if (!order.returnUrls) {
      logWarn("Create", "no returnUrls from Wix, buyer will land on fallback page", context);
    }
    const continueUrl = await buildContinueUrl(wixTransactionId, order.returnUrls);
    const customerIp = options?.fraudInformation?.remoteIp;
    if (!customerIp) {
      logWarn("Create", "no buyer IP from Wix, using 127.0.0.1", context);
    }

    const payuOrder = {
      notifyUrl: PayUNotifyUrl,
      continueUrl,
      merchantPosId: posId,
      customerIp: customerIp || "127.0.0.1",
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
    const productsSum = payuOrder.products.reduce(function (sum, p) {
      return sum + Number(p.unitPrice) * p.quantity;
    }, 0);
    logInfo("Create", "sending order to PayU", {
      ...context,
      posId,
      continueUrl,
      notifyUrl: PayUNotifyUrl,
      productsSum,
      products: payuOrder.products,
    });

    const response = await fetch(PayUOrdersUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payuOrder),
      redirect: "manual",
    });
    const { data, text } = await readResponse(response);
    const payuStatus = data?.status || {};
    const result = {
      ...context,
      httpStatus: response.status,
      statusCode: payuStatus.statusCode,
      code: payuStatus.code,
      codeLiteral: payuStatus.codeLiteral,
      statusDesc: payuStatus.statusDesc,
      orderId: data?.orderId,
    };

    if (!data?.redirectUri || !data?.orderId) {
      return providerError(
        "No payment link from PayU. Status: " +
          (payuStatus.statusCode || response.status) +
          (payuStatus.statusDesc ? " - " + payuStatus.statusDesc : ""),
        { ...result, body: data ? undefined : text },
      );
    }
    logInfo("Create", "success: buyer redirected to PayU", result);

    return {
      pluginTransactionId: data.orderId,
      redirectUrl: data.redirectUri,
    };
  } catch (err) {
    logError("Create", "exception", { ...context, error: err?.message || String(err), stack: err?.stack });
    return {
      errorCode: "PROVIDER_ERROR",
      errorMessage: err && err.message ? err.message : String(err),
    };
  }
}

export async function refundTransaction(options) {
  logWarn("Refund", "requested from Wix, not supported - refund manually in PayU panel", {
    wixTransactionId: options?.wixTransactionId,
    pluginTransactionId: options?.pluginTransactionId,
    refundAmount: options?.refundAmount,
  });
  return {
    errorCode: "PROVIDER_ERROR",
    errorMessage: "Make refunds manually in the PayU panel.",
  };
}
