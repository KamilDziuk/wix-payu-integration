import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import {
  verifyPayuSignature,
  getPayuOrder,
  getPayuOrderByExtId,
} from "backend/payU/payU-client";
import { buildContinueUrl } from "backend/payU/payU-return";
import { getPayUContinueUrl } from "backend/payU/payU-env";
import { post_payuNotify, get_payuReturn } from "backend/http-functions";

vi.mock("backend/payU/payU-client", async (importOriginal) => ({
  ...(await importOriginal()),
  verifyPayuSignature: vi.fn(),
  getPayuOrder: vi.fn(),
  getPayuOrderByExtId: vi.fn(),
}));

const { submitEvent } = wixPaymentProviderBackend;

beforeEach(() => {
  verifyPayuSignature.mockReset().mockResolvedValue(true);
  getPayuOrder.mockReset();
  getPayuOrderByExtId.mockReset();
  submitEvent.mockReset().mockResolvedValue(undefined);
});

describe("post_payuNotify", () => {
  const notifyRequest = (body, headers = { "openpayu-signature": "sig" }) => ({
    body: { text: async () => (typeof body === "string" ? body : JSON.stringify(body)) },
    headers,
    ip: "185.68.12.10",
  });
  const notification = (status = "COMPLETED") => ({
    order: { orderId: "P1", extOrderId: "W1", status },
    localReceiptDateTime: "2026-11-22T10:00:00Z",
  });
  const payuOrder = (status) => ({ orderId: "P1", extOrderId: "W1", status });

  it("passes the raw body and signature header to the signature check", async () => {
    getPayuOrder.mockResolvedValue(payuOrder("PENDING"));
    const raw = JSON.stringify(notification("PENDING"));
    await post_payuNotify(notifyRequest(raw));
    expect(verifyPayuSignature).toHaveBeenCalledWith(raw, "sig");
  });

  it("returns 403 on an invalid signature", async () => {
    verifyPayuSignature.mockResolvedValue(false);
    const res = await post_payuNotify(notifyRequest(notification(), {}));
    expect(res.status).toBe(403);
    expect(getPayuOrder).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await post_payuNotify(notifyRequest("not json"));
    expect(res.status).toBe(400);
  });

  it.each([
    [{}],
    [{ order: { orderId: "P1" } }],
    [{ order: { extOrderId: "W1" } }],
    [null],
  ])("returns 400 when order IDs are missing: %j", async (body) => {
    const res = await post_payuNotify(notifyRequest(body));
    expect(res.status).toBe(400);
  });

  it("acknowledges refund notifications without updating Wix", async () => {
    const res = await post_payuNotify(
      notifyRequest({
        orderId: "P1",
        extOrderId: "W1",
        refund: { refundId: "R1", status: "FINALIZED", amount: "100", currencyCode: "PLN" },
      }),
    );
    expect(res.status).toBe(200);
    expect(getPayuOrder).not.toHaveBeenCalled();
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when PayU cannot be reached, so PayU retries", async () => {
    getPayuOrder.mockRejectedValue(new Error("timeout"));
    const res = await post_payuNotify(notifyRequest(notification()));
    expect(res.status).toBe(500);
  });

  it("returns 400 when PayU does not know the order", async () => {
    getPayuOrder.mockResolvedValue(null);
    const res = await post_payuNotify(notifyRequest(notification()));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the extOrderId does not match PayU", async () => {
    getPayuOrder.mockResolvedValue({ ...payuOrder("COMPLETED"), extOrderId: "OTHER" });
    const res = await post_payuNotify(notifyRequest(notification()));
    expect(res.status).toBe(400);
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("approves the Wix transaction on COMPLETED", async () => {
    getPayuOrder.mockResolvedValue(payuOrder("COMPLETED"));
    const res = await post_payuNotify(notifyRequest(notification()));
    expect(res.status).toBe(200);
    expect(getPayuOrder).toHaveBeenCalledWith("P1");
    expect(submitEvent).toHaveBeenCalledWith({
      event: { transaction: { wixTransactionId: "W1", pluginTransactionId: "P1" } },
    });
  });

  it("uses the status from PayU, not from the notification", async () => {
    getPayuOrder.mockResolvedValue(payuOrder("PENDING"));
    const res = await post_payuNotify(notifyRequest(notification("COMPLETED")));
    expect(res.status).toBe(200);
    expect(submitEvent).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("notified status differs from PayU status"),
    );
  });

  it("reports CANCELED as a buyer cancellation", async () => {
    getPayuOrder.mockResolvedValue(payuOrder("CANCELED"));
    const res = await post_payuNotify(notifyRequest(notification("CANCELED")));
    expect(res.status).toBe(200);
    expect(submitEvent).toHaveBeenCalledWith({
      event: {
        transaction: {
          wixTransactionId: "W1",
          pluginTransactionId: "P1",
          reasonCode: 3030,
          errorCode: "BUYER_CANCELED",
          errorMessage: "Payment canceled in PayU.",
        },
      },
    });
  });

  it.each(["NEW", "PENDING", "WAITING_FOR_CONFIRMATION", "UNKNOWN"])(
    "acknowledges %s without updating Wix",
    async (status) => {
      getPayuOrder.mockResolvedValue(payuOrder(status));
      const res = await post_payuNotify(notifyRequest(notification(status)));
      expect(res.status).toBe(200);
      expect(submitEvent).not.toHaveBeenCalled();
    },
  );

  it.each([new Error("wix down"), "plain failure"])(
    "returns 500 when submitEvent fails (%s)",
    async (failure) => {
      getPayuOrder.mockResolvedValue(payuOrder("COMPLETED"));
      submitEvent.mockRejectedValue(failure);
      const res = await post_payuNotify(notifyRequest(notification()));
      expect(res.status).toBe(500);
    },
  );
});

describe("get_payuReturn", () => {
  const returnUrls = {
    successUrl: "https://www.agnieszkalozinska.com/thank-you",
    errorUrl: "https://www.agnieszkalozinska.com/checkout?error",
    pendingUrl: "https://www.agnieszkalozinska.com/pending",
    cancelUrl: "https://www.agnieszkalozinska.com/checkout?cancel",
  };
  const returnRequest = async (extra = "") => {
    const url = await buildContinueUrl("W1", returnUrls);
    return { query: Object.fromEntries(new URL(url + extra).searchParams) };
  };
  const location = (res) => res.headers.Location;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("redirects to the fallback page without parameters", async () => {
    const res = await get_payuReturn({ query: {} });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(getPayUContinueUrl());
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(getPayuOrderByExtId).not.toHaveBeenCalled();
  });

  it("redirects to the fallback page on a tampered URL", async () => {
    const req = await returnRequest();
    req.query.s = "https://evil.example/";
    const res = await get_payuReturn(req);
    expect(location(res)).toBe(getPayUContinueUrl());
  });

  it.each([
    ["COMPLETED", "successUrl"],
    ["WAITING_FOR_CONFIRMATION", "successUrl"],
    ["CANCELED", "cancelUrl"],
  ])("redirects %s to %s", async (status, field) => {
    getPayuOrderByExtId.mockResolvedValue({ status });
    const res = await get_payuReturn(await returnRequest());
    expect(getPayuOrderByExtId).toHaveBeenCalledWith("W1");
    expect(res.status).toBe(302);
    expect(location(res)).toBe(returnUrls[field]);
  });

  it("sends failed payments to the error page without waiting", async () => {
    getPayuOrderByExtId.mockResolvedValue({ status: "PENDING" });
    const res = await get_payuReturn(await returnRequest("&error=501"));
    expect(getPayuOrderByExtId).toHaveBeenCalledTimes(1);
    expect(location(res)).toBe(returnUrls.errorUrl);
  });

  it("rechecks a pending order and redirects once it completes", async () => {
    vi.useFakeTimers();
    getPayuOrderByExtId
      .mockResolvedValueOnce({ status: "NEW" })
      .mockResolvedValueOnce({ status: "COMPLETED" });
    const pending = get_payuReturn(await returnRequest());
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(getPayuOrderByExtId).toHaveBeenCalledTimes(2);
    expect(location(res)).toBe(returnUrls.successUrl);
  });

  it("gives up after the retries and redirects to the pending page", async () => {
    vi.useFakeTimers();
    getPayuOrderByExtId.mockResolvedValue({ status: "PENDING" });
    const pending = get_payuReturn(await returnRequest());
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(getPayuOrderByExtId).toHaveBeenCalledTimes(3);
    expect(location(res)).toBe(returnUrls.pendingUrl);
  });

  it("redirects to the pending page when the order is unknown", async () => {
    getPayuOrderByExtId.mockResolvedValue(null);
    const res = await get_payuReturn(await returnRequest());
    expect(location(res)).toBe(returnUrls.pendingUrl);
  });

  it.each([new Error("PayU down"), "plain failure"])(
    "redirects to the pending page when the lookup fails (%s)",
    async (failure) => {
      getPayuOrderByExtId.mockRejectedValue(failure);
      const res = await get_payuReturn(await returnRequest());
      expect(location(res)).toBe(returnUrls.pendingUrl);
    },
  );
});
