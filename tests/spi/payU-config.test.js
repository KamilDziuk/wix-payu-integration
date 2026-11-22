import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConfig } from "backend/___spi___/payment-provider/payU/payU-config";

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

beforeEach(() => {
  env.enabled = true;
  env.test = true;
});

describe("getConfig", () => {
  it("matches the registered config", () => {
    env.test = false;
    expect(getConfig()).toMatchSnapshot();
  });

  // A wrong shape here makes Wix silently refuse to register the plugin.
  it("follows the Wix payment provider schema", () => {
    const config = getConfig();
    expect(Array.isArray(config.paymentMethods)).toBe(true);
    expect(config.paymentMethods).toHaveLength(1);

    const { hostedPage } = config.paymentMethods[0];
    expect(typeof hostedPage.title).toBe("string");
    expect(Array.isArray(hostedPage.billingAddressMandatoryFields)).toBe(true);
    for (const variant of ["white", "colored"]) {
      expect(Object.keys(hostedPage.logos[variant]).sort()).toEqual(["png", "svg"]);
    }

    expect(config.credentialsFields).toEqual([
      { simpleField: { name: "payUPosId", label: "PayU POS ID" } },
    ]);
  });

  it("marks the title in test mode", () => {
    expect(getConfig().title).toBe("PayU [TEST ONLY - NOT REAL PAYMENT]");
    env.test = false;
    expect(getConfig().title).toBe("PayU");
  });

  it("logs whether payments are enabled", () => {
    getConfig();
    expect(console.log).toHaveBeenLastCalledWith("PayU getConfig - enabled");
    env.enabled = false;
    getConfig();
    expect(console.log).toHaveBeenLastCalledWith(
      "PayU getConfig - disabled: transactions will be rejected",
    );
  });
});
