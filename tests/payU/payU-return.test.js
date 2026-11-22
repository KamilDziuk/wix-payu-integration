import { describe, it, expect } from "vitest";
import { PayUReturnUrl, getPayUContinueUrl } from "backend/payU/payU-env";
import {
  buildContinueUrl,
  readReturnParams,
  pickReturnTarget,
  resolveReturnUrl,
} from "backend/payU/payU-return";

const site = "https://www.agnieszkalozinska.com/checkout?state=%7B%22a%22%3A1%7D&step=";
const returnUrls = {
  successUrl: site + "ok",
  errorUrl: site + "err",
  pendingUrl: site + "pending",
  cancelUrl: site + "cancel",
};

// What Wix passes as request.query once PayU sends the buyer back.
const queryOf = (url, extra = "") => Object.fromEntries(new URL(url + extra).searchParams);

describe("buildContinueUrl / readReturnParams", () => {
  it("round-trips the transaction ID and all return URLs", async () => {
    const url = await buildContinueUrl("tx-1", returnUrls);
    expect(url.startsWith(PayUReturnUrl + "?tx=tx-1&")).toBe(true);
    expect(url.length).toBeLessThanOrEqual(1024);

    const params = await readReturnParams(queryOf(url));
    expect(params).toEqual({ tx: "tx-1", valid: true, urls: returnUrls });
  });

  it("ignores extra parameters PayU appends", async () => {
    const url = await buildContinueUrl("tx-1", returnUrls);
    const params = await readReturnParams(queryOf(url, "&error=501"));
    expect(params.valid).toBe(true);
  });

  it("works with some or no return URLs", async () => {
    const url = await buildContinueUrl("tx-2", { successUrl: returnUrls.successUrl });
    const params = await readReturnParams(queryOf(url));
    expect(params.valid).toBe(true);
    expect(params.urls.successUrl).toBe(returnUrls.successUrl);
    expect(params.urls.errorUrl).toBeUndefined();

    const bare = await buildContinueUrl("tx-3", undefined);
    expect(bare).toMatch(/\?tx=tx-3&sig=[0-9a-f]{32}$/);
    expect((await readReturnParams(queryOf(bare))).valid).toBe(true);
  });

  it("rejects a swapped return URL", async () => {
    const query = queryOf(await buildContinueUrl("tx-1", returnUrls));
    query.s = "https://evil.example/";
    expect((await readReturnParams(query)).valid).toBe(false);
  });

  it("rejects a changed transaction ID or missing signature", async () => {
    const query = queryOf(await buildContinueUrl("tx-1", returnUrls));
    expect((await readReturnParams({ ...query, tx: "tx-2" })).valid).toBe(false);
    const { sig: _sig, ...unsigned } = query;
    expect((await readReturnParams(unsigned)).valid).toBe(false);
  });

  it("returns null without a transaction ID", async () => {
    expect(await readReturnParams({})).toBeNull();
    expect(await readReturnParams(undefined)).toBeNull();
  });

  it("drops cancel, then pending, then error URLs when too long", async () => {
    const long = (tag) => "https://www.agnieszkalozinska.com/" + tag.repeat(280);
    const urls = {
      successUrl: long("s"),
      errorUrl: long("e"),
      pendingUrl: long("p"),
      cancelUrl: long("c"),
    };
    const url = await buildContinueUrl("tx-4", urls);
    expect(url.length).toBeLessThanOrEqual(1024);
    const params = await readReturnParams(queryOf(url));
    expect(params.valid).toBe(true);
    expect(params.urls).toEqual({
      successUrl: urls.successUrl,
      errorUrl: urls.errorUrl,
      pendingUrl: undefined,
      cancelUrl: undefined,
    });
  });

  it("falls back to the Wix success URL, then the thank-you page", async () => {
    // Fits on its own, but not once encoded into the continueUrl.
    const successUrl = "https://www.agnieszkalozinska.com/?q=" + "/".repeat(900);
    await expect(buildContinueUrl("tx-5", { successUrl })).resolves.toBe(successUrl);

    const huge = "https://www.agnieszkalozinska.com/" + "x".repeat(1100);
    await expect(buildContinueUrl("tx-6", { successUrl: huge })).resolves.toBe(getPayUContinueUrl());
    await expect(buildContinueUrl("x".repeat(1100), {})).resolves.toBe(getPayUContinueUrl());
  });
});

describe("pickReturnTarget", () => {
  it.each([
    ["COMPLETED", undefined, "successUrl"],
    ["COMPLETED", "501", "successUrl"],
    ["WAITING_FOR_CONFIRMATION", undefined, "successUrl"],
    ["CANCELED", undefined, "cancelUrl"],
    ["CANCELED", "501", "errorUrl"],
    ["NEW", undefined, "pendingUrl"],
    ["PENDING", undefined, "pendingUrl"],
    ["PENDING", "501", "errorUrl"],
    [null, undefined, "pendingUrl"],
    [null, "501", "errorUrl"],
    ["SOMETHING_ELSE", undefined, "pendingUrl"],
  ])("status %s with error %s -> %s", (status, error, target) => {
    expect(pickReturnTarget(status, error)).toBe(target);
  });
});

describe("resolveReturnUrl", () => {
  it("uses the target URL when present", () => {
    expect(resolveReturnUrl(returnUrls, "cancelUrl")).toEqual({
      url: returnUrls.cancelUrl,
      field: "cancelUrl",
    });
  });

  it.each([
    ["pendingUrl", { successUrl: "s" }, "successUrl"],
    ["cancelUrl", { errorUrl: "e" }, "errorUrl"],
    ["errorUrl", { cancelUrl: "c" }, "cancelUrl"],
  ])("falls back from %s", (target, urls, field) => {
    expect(resolveReturnUrl(urls, target).field).toBe(field);
  });

  it("falls back to the thank-you page when nothing matches", () => {
    expect(resolveReturnUrl({}, "successUrl")).toEqual({
      url: getPayUContinueUrl(),
      field: "fallback",
    });
    expect(resolveReturnUrl(undefined, "errorUrl").field).toBe("fallback");
  });
});
