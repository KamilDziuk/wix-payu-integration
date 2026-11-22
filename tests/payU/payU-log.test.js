import { describe, it, expect, vi, beforeEach } from "vitest";
import { logInfo, logWarn, logError } from "backend/payU/payU-log";

describe("payU-log", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs info with scope prefix and JSON data", () => {
    logInfo("Create", "start", { a: 1 });
    expect(console.log).toHaveBeenCalledWith('[PayU Create] start {"a":1}');
  });

  it("omits data when not given", () => {
    logWarn("Webhook", "hello");
    expect(console.warn).toHaveBeenCalledWith("[PayU Webhook] hello");
  });

  it("serializes errors with message and stack", () => {
    const err = new Error("boom");
    logError("Token", "failed", err);
    const line = console.error.mock.calls[0][0];
    expect(line).toMatch(/^\[PayU Token\] failed /);
    const data = JSON.parse(line.slice("[PayU Token] failed ".length));
    expect(data.error).toBe("boom");
    expect(data.stack).toContain("boom");
  });

  it("falls back to String() for values JSON cannot serialize", () => {
    const circular = {};
    circular.self = circular;
    logInfo("Order", "x", circular);
    expect(console.log).toHaveBeenCalledWith("[PayU Order] x [object Object]");
  });
});
