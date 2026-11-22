import { describe, it, expect } from "vitest";
import {
  PayUOrderStatus,
  isAwaitingPayment,
  hasBuyerPaid,
} from "backend/payU/payU-order-status";

describe("payU-order-status", () => {
  it.each([
    [PayUOrderStatus.NEW, true, false],
    [PayUOrderStatus.PENDING, true, false],
    [PayUOrderStatus.WAITING_FOR_CONFIRMATION, false, true],
    [PayUOrderStatus.COMPLETED, false, true],
    [PayUOrderStatus.CANCELED, false, false],
    [null, false, false],
    ["SOMETHING_ELSE", false, false],
  ])("%s: awaiting payment %s, paid %s", (status, awaiting, paid) => {
    expect(isAwaitingPayment(status)).toBe(awaiting);
    expect(hasBuyerPaid(status)).toBe(paid);
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(PayUOrderStatus)).toBe(true);
  });
});
