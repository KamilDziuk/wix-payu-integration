import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import { getPayuToken } from "backend/payU/payU-client";
import {
  PayUOrdersUrl,
  PayUNotifyUrl,
  PayUReturnUrl,
  PayUTestPointOfSalesId,
} from "backend/payU/payU-env";
import {
  connectAccount,
  createTransaction,
  refundTransaction,
} from "backend/___spi___/payment-provider/payU/payU";
import { fakeResponse } from "../helpers.js";

const env = vi.hoisted(() => ({ enabled: true, test: true }));
vi.mock("backend/payU/payU-env", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get PayUEnabled() {
      return env.enabled;
    },
    isTest: () => env.test,
  };
});
vi.mock("backend/payU/payU-client", async (importOriginal) => ({
  ...(await importOriginal()),
  getPayuToken: vi.fn(),
}));

const options = (overrides = {}) => ({
  wixTransactionId: "W1",
  order: {
    _id: "O1",
    description: {
      items: [
        { name: "Torebka", quantity: 2, price: "15000" },
        { quantity: undefined, price: 500 },
      ],
      totalAmount: "30500",
      currency: "PLN",
    },
    returnUrls: {
      successUrl: "https://www.agnieszkalozinska.com/thank-you",
      errorUrl: "https://www.agnieszkalozinska.com/checkout",
    },
  },
  merchantCredentials: { payUPosId: "999" },
  fraudInformation: { remoteIp: "1.2.3.4" },
  ...overrides,
});
const created = () =>
  fakeResponse(302, {
    status: { statusCode: "SUCCESS" },
    redirectUri: "https://secure.payu.com/pay/?orderId=P1",
    orderId: "P1",
  });
const sentOrder = () => JSON.parse(fetch.mock.calls[0][1].body);
const PROVIDER_ERROR = (errorMessage) => ({ errorCode: "PROVIDER_ERROR", errorMessage });

beforeEach(() => {
  env.enabled = true;
  env.test = true;
  fetch.mockReset();
  getSecret.mockReset().mockResolvedValue(undefined);
  getPayuToken.mockReset().mockResolvedValue("tok");
});

describe("connectAccount", () => {
  it("uses the POS ID as the account ID", async () => {
    const credentials = { payUPosId: "123" };
    await expect(connectAccount({ credentials })).resolves.toEqual({
      accountId: "123",
      credentials,
    });
  });

  it("falls back to a fixed account ID", async () => {
    await expect(connectAccount(undefined)).resolves.toEqual({
      accountId: "payu",
      credentials: {},
    });
  });
});

describe("createTransaction", () => {
  it("creates a PayU order and returns the redirect", async () => {
    fetch.mockResolvedValueOnce(created());
    await expect(createTransaction(options())).resolves.toEqual({
      pluginTransactionId: "P1",
      redirectUrl: "https://secure.payu.com/pay/?orderId=P1",
    });

    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(PayUOrdersUrl);
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("manual");
    expect(request.headers).toEqual({
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
    });
    const body = sentOrder();
    expect(body).toMatchObject({
      notifyUrl: PayUNotifyUrl,
      merchantPosId: PayUTestPointOfSalesId,
      customerIp: "1.2.3.4",
      extOrderId: "W1",
      description: "Zamówienie W1",
      currencyCode: "PLN",
      totalAmount: "30500",
      products: [
        { name: "Torebka", unitPrice: "15000", quantity: 2 },
        { name: "Produkt", unitPrice: "500", quantity: 1 },
      ],
    });
    expect(body.continueUrl.startsWith(PayUReturnUrl + "?tx=W1&")).toBe(true);
  });

  it("defaults the currency, IP and missing return URLs", async () => {
    fetch.mockResolvedValueOnce(created());
    const opts = options({ fraudInformation: undefined });
    delete opts.order.description.currency;
    delete opts.order.returnUrls;
    await createTransaction(opts);
    const body = sentOrder();
    expect(body.currencyCode).toBe("PLN");
    expect(body.customerIp).toBe("127.0.0.1");
    expect(body.continueUrl).toMatch(/\?tx=W1&sig=[0-9a-f]{32}$/);
  });

  it("uses the connected account's POS ID in prod", async () => {
    env.test = false;
    getSecret.mockImplementation(async (name) => (name === "PAYU_SECOND_KEY" ? "k" : undefined));
    fetch.mockResolvedValueOnce(created());
    await createTransaction(options());
    expect(sentOrder().merchantPosId).toBe("999");
  });

  it("falls back to the PAYU_POS_ID secret in prod", async () => {
    env.test = false;
    getSecret.mockImplementation(async (name) =>
      ({ PAYU_POS_ID: "777", PAYU_SECOND_KEY: "k" })[name],
    );
    fetch.mockResolvedValueOnce(created());
    await createTransaction(options({ merchantCredentials: {} }));
    expect(sentOrder().merchantPosId).toBe("777");
  });

  it("fails when no POS ID is configured in prod", async () => {
    env.test = false;
    await expect(createTransaction(options({ merchantCredentials: undefined }))).resolves.toEqual(
      PROVIDER_ERROR("PayU POS ID not configured"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails when payments are disabled", async () => {
    env.enabled = false;
    await expect(createTransaction(options())).resolves.toEqual(
      PROVIDER_ERROR("PayU payments are disabled"),
    );
    expect(getPayuToken).not.toHaveBeenCalled();
  });

  it.each([
    [{ wixTransactionId: undefined }],
    [{ order: undefined }],
  ])("fails without transaction data %#", async (overrides) => {
    await expect(createTransaction(options(overrides))).resolves.toEqual(
      PROVIDER_ERROR("No transaction data"),
    );
  });

  it("fails without products", async () => {
    const opts = options();
    opts.order.description.items = [];
    await expect(createTransaction(opts)).resolves.toEqual(
      PROVIDER_ERROR("No products in the order"),
    );
  });

  it("handles an order with no description at all", async () => {
    await expect(
      createTransaction({ wixTransactionId: "W1", order: { _id: "O1" } }),
    ).resolves.toEqual(PROVIDER_ERROR("No products in the order"));
  });

  it("reports PayU's status code and description on rejection", async () => {
    fetch.mockResolvedValueOnce(
      fakeResponse(400, {
        status: {
          statusCode: "ERROR_VALUE_INVALID",
          code: "8061",
          codeLiteral: "INVALID_TOTAL_AMOUNT",
          statusDesc: "Invalid total amount",
        },
      }),
    );
    await expect(createTransaction(options())).resolves.toEqual(
      PROVIDER_ERROR("No payment link from PayU. Status: ERROR_VALUE_INVALID - Invalid total amount"),
    );
  });

  it("reports the HTTP status for a non-JSON response", async () => {
    fetch.mockResolvedValueOnce(fakeResponse(503, "<html>maintenance</html>"));
    await expect(createTransaction(options())).resolves.toEqual(
      PROVIDER_ERROR("No payment link from PayU. Status: 503"),
    );
  });

  it.each([new Error("OAuth failed"), "plain failure"])(
    "turns exceptions into a provider error (%s)",
    async (failure) => {
      getPayuToken.mockRejectedValue(failure);
      await expect(createTransaction(options())).resolves.toEqual(
        PROVIDER_ERROR(failure instanceof Error ? failure.message : failure),
      );
    },
  );
});

describe("refundTransaction", () => {
  it("asks for a manual refund in the PayU panel", async () => {
    await expect(
      refundTransaction({ wixTransactionId: "W1", pluginTransactionId: "P1", refundAmount: 100 }),
    ).resolves.toEqual(PROVIDER_ERROR("Make refunds manually in the PayU panel."));
  });
});
