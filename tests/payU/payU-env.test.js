import { describe, it, expect } from "vitest";
import * as env from "backend/payU/payU-env";

describe("payU-env", () => {
  it("builds the fallback continue URL with and without an order ID", () => {
    expect(env.getPayUContinueUrl()).toBe(env.PayUContinueUrl);
    expect(env.getPayUContinueUrl("order-1")).toBe(env.PayUContinueUrl + "/order-1");
  });

  it("reports test mode from PayUEnvironment", () => {
    expect(env.isTest()).toBe(env.PayUEnvironment === "test");
  });

  it("points PayU callbacks at the site's HTTP functions", () => {
    expect(env.PayUNotifyUrl).toMatch(/^https:\/\/www\.agnieszkalozinska\.com\/_functions\/payuNotify$/);
    expect(env.PayUReturnUrl).toMatch(/^https:\/\/www\.agnieszkalozinska\.com\/_functions\/payuReturn$/);
  });

  it("uses PayU API base URLs that the client appends paths to", () => {
    expect(env.PayUOrdersUrl.endsWith("/api/v2_1/orders/")).toBe(true);
    expect(env.PayUAuthUrl).toContain("/oauth/authorize");
  });
});
