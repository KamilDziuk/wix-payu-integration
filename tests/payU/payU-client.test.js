import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { fetch } from "wix-fetch";
import { getSecret } from "wix-secrets-backend";
import {
  PayUAuthUrl,
  PayUOrdersUrl,
  PayUTestClientId,
  PayUTestClientSecret,
  PayUTestSecondKey,
} from "backend/payU/payU-env";
import {
  readResponse,
  summarizeOrder,
  getPayuToken,
  getPayuOrder,
  getPayuOrderByExtId,
  signValue,
  verifySignedValue,
  verifyPayuSignature,
} from "backend/payU/payU-client";
import { fakeResponse } from "../helpers.js";

const env = vi.hoisted(() => ({ test: true }));
vi.mock("backend/payU/payU-env", async (importOriginal) => ({
  ...(await importOriginal()),
  isTest: () => env.test,
}));

const PROD_SECRETS = {
  PAYU_CLIENT_ID: "prod-id",
  PAYU_CLIENT_SECRET: "prod-secret",
  PAYU_SECOND_KEY: "prod-second-key",
};

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tokenResponse = () =>
  fakeResponse(200, { access_token: "tok", expires_in: 43199, grant_type: "client_credentials" });

beforeEach(() => {
  env.test = true;
  fetch.mockReset();
  getSecret.mockReset();
  getSecret.mockImplementation(async (name) => PROD_SECRETS[name]);
});

describe("readResponse", () => {
  it("parses JSON bodies", async () => {
    const result = await readResponse(fakeResponse(200, { a: 1 }));
    expect(result.data).toEqual({ a: 1 });
  });

  it("keeps non-JSON text, truncated to 1000 chars", async () => {
    const result = await readResponse(fakeResponse(500, "<html>" + "x".repeat(2000)));
    expect(result.data).toBeNull();
    expect(result.text).toHaveLength(1000);
  });

  it("handles an empty non-JSON body", async () => {
    const result = await readResponse({ text: async () => "" });
    expect(result).toEqual({ data: null, text: "" });
  });
});

describe("summarizeOrder", () => {
  it("returns null for no order", () => {
    expect(summarizeOrder(null)).toBeNull();
  });

  it("keeps order fields and drops buyer data", () => {
    const summary = summarizeOrder({
      orderId: "P1",
      extOrderId: "W1",
      status: "COMPLETED",
      totalAmount: "100",
      currencyCode: "PLN",
      payMethod: { type: "PBL" },
      orderCreateDate: "d1",
      localReceiptDateTime: "d2",
      buyer: { email: "a@b.c", phone: "123" },
    });
    expect(summary).toEqual({
      orderId: "P1",
      extOrderId: "W1",
      status: "COMPLETED",
      totalAmount: "100",
      currencyCode: "PLN",
      payMethod: "PBL",
      orderCreateDate: "d1",
      localReceiptDateTime: "d2",
    });
  });
});

describe("getPayuToken", () => {
  it("uses the test credentials in test mode", async () => {
    fetch.mockResolvedValueOnce(tokenResponse());
    await expect(getPayuToken()).resolves.toBe("tok");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(PayUAuthUrl);
    expect(options.method).toBe("POST");
    expect(options.body).toBe(
      "grant_type=client_credentials&client_id=" +
        PayUTestClientId +
        "&client_secret=" +
        PayUTestClientSecret,
    );
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("reads and URL-encodes the secrets in prod mode", async () => {
    env.test = false;
    getSecret.mockImplementation(async (name) =>
      name === "PAYU_CLIENT_SECRET" ? "a&b=c" : PROD_SECRETS[name],
    );
    fetch.mockResolvedValueOnce(tokenResponse());
    await getPayuToken();
    expect(fetch.mock.calls[0][1].body).toBe(
      "grant_type=client_credentials&client_id=prod-id&client_secret=a%26b%3Dc",
    );
  });

  it("throws when credentials are missing", async () => {
    env.test = false;
    getSecret.mockResolvedValue(undefined);
    await expect(getPayuToken()).rejects.toThrow("PayU client credentials not configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws on an OAuth error response", async () => {
    fetch.mockResolvedValueOnce(fakeResponse(401, { error: "invalid_client" }));
    await expect(getPayuToken()).rejects.toThrow("PayU OAuth error: 401");
  });

  it("throws on a non-JSON error response", async () => {
    fetch.mockResolvedValueOnce(fakeResponse(503, "<html>down</html>"));
    await expect(getPayuToken()).rejects.toThrow("PayU OAuth error: 503");
  });

  it("throws when no access token is returned", async () => {
    fetch.mockResolvedValueOnce(fakeResponse(200, {}));
    await expect(getPayuToken()).rejects.toThrow("PayU did not return a token");
  });
});

describe("getPayuOrder / getPayuOrderByExtId", () => {
  const order = { orderId: "P 1", extOrderId: "W/1", status: "PENDING" };

  it("fetches by PayU order ID with a bearer token", async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        fakeResponse(200, { orders: [order], status: { statusCode: "SUCCESS" } }),
      );
    await expect(getPayuOrder("P 1")).resolves.toEqual(order);
    const [url, options] = fetch.mock.calls[1];
    expect(url).toBe(PayUOrdersUrl + "P%201");
    expect(options).toEqual({ method: "GET", headers: { Authorization: "Bearer tok" } });
  });

  it("fetches by extOrderId under /ext/", async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(fakeResponse(200, { orders: [order] }));
    await expect(getPayuOrderByExtId("W/1")).resolves.toEqual(order);
    expect(fetch.mock.calls[1][0]).toBe(PayUOrdersUrl + "ext/W%2F1");
  });

  it("returns null on 404", async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(fakeResponse(404, { status: { statusCode: "DATA_NOT_FOUND" } }));
    await expect(getPayuOrder("X")).resolves.toBeNull();
  });

  it("returns null when the response has no orders", async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(fakeResponse(200, {}));
    await expect(getPayuOrder("X")).resolves.toBeNull();
  });

  it("throws on other errors, JSON or not", async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(fakeResponse(500, { status: { statusCode: "ERROR" } }));
    await expect(getPayuOrder("X")).rejects.toThrow("response error: 500");

    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(fakeResponse(502, "bad"));
    await expect(getPayuOrder("X")).rejects.toThrow("response error: 502");
  });
});

describe("signValue / verifySignedValue", () => {
  const hmac = (value, key) =>
    crypto.createHmac("sha256", key).update(value).digest("hex").slice(0, 32);

  it("signs with HMAC-SHA256 of the second key, truncated to 32 chars", async () => {
    await expect(signValue("abc")).resolves.toBe(hmac("abc", PayUTestSecondKey));
    env.test = false;
    await expect(signValue("abc")).resolves.toBe(hmac("abc", "prod-second-key"));
  });

  it("throws when the second key is missing", async () => {
    env.test = false;
    getSecret.mockResolvedValue(undefined);
    await expect(signValue("abc")).rejects.toThrow("second key not configured");
  });

  it("verifies matching signatures only", async () => {
    const sig = hmac("abc", PayUTestSecondKey);
    await expect(verifySignedValue("abc", sig)).resolves.toBe(true);
    await expect(verifySignedValue("abd", sig)).resolves.toBe(false);
    await expect(verifySignedValue("abc", sig.slice(1))).resolves.toBe(false);
    await expect(verifySignedValue("abc", undefined)).resolves.toBe(false);
  });

  it("returns false when the key is missing", async () => {
    env.test = false;
    getSecret.mockResolvedValue(undefined);
    await expect(verifySignedValue("abc", "x")).resolves.toBe(false);
  });
});

describe("verifyPayuSignature", () => {
  const body = '{"order":{"orderId":"P1"}}';
  const header = (signature, extra = ";algorithm=MD5;content=DOCUMENT") =>
    "sender=checkout;signature=" + signature + extra;

  it("accepts a valid MD5 signature", async () => {
    await expect(verifyPayuSignature(body, header(md5(body + PayUTestSecondKey)))).resolves.toBe(true);
  });

  it("accepts an uppercase signature and spaces around pairs", async () => {
    const sig = md5(body + PayUTestSecondKey).toUpperCase();
    await expect(
      verifyPayuSignature(body, "sender=checkout; signature=" + sig + " ; algorithm=MD5"),
    ).resolves.toBe(true);
  });

  it("defaults to MD5 when no algorithm is given", async () => {
    await expect(verifyPayuSignature(body, header(md5(body + PayUTestSecondKey), ""))).resolves.toBe(true);
  });

  it("accepts SHA-256 and SHA256", async () => {
    const sig = sha256(body + PayUTestSecondKey);
    await expect(verifyPayuSignature(body, header(sig, ";algorithm=SHA-256"))).resolves.toBe(true);
    await expect(verifyPayuSignature(body, header(sig, ";algorithm=SHA256"))).resolves.toBe(true);
  });

  it("uses the prod second key outside test mode", async () => {
    env.test = false;
    await expect(verifyPayuSignature(body, header(md5(body + "prod-second-key")))).resolves.toBe(true);
    await expect(verifyPayuSignature(body, header(md5(body + PayUTestSecondKey)))).resolves.toBe(false);
  });

  it("rejects a tampered body", async () => {
    const sig = md5(body + PayUTestSecondKey);
    await expect(verifyPayuSignature(body + " ", header(sig))).resolves.toBe(false);
  });

  it("rejects a missing header or signature", async () => {
    await expect(verifyPayuSignature(body, undefined)).resolves.toBe(false);
    await expect(verifyPayuSignature(body, "sender=checkout;algorithm=MD5;junk")).resolves.toBe(false);
  });

  it("rejects when the second key is missing", async () => {
    env.test = false;
    getSecret.mockResolvedValue(undefined);
    await expect(verifyPayuSignature(body, header("abc"))).resolves.toBe(false);
  });

  it("rejects unsupported algorithms", async () => {
    await expect(verifyPayuSignature(body, header("abc", ";algorithm=SHA1"))).resolves.toBe(false);
  });
});
