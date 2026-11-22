// @ts-nocheck
// PayU order statuses: https://developers.payu.com/europe/docs/payment-flows/lifecycle/
export const PayUOrderStatus = Object.freeze({
  // Order created, buyer has not started paying.
  NEW: "NEW",
  // Buyer started paying, PayU is waiting for the money.
  PENDING: "PENDING",
  // Buyer paid, merchant has to confirm or cancel in the PayU panel
  // (only when automatic collection is off for the POS).
  WAITING_FOR_CONFIRMATION: "WAITING_FOR_CONFIRMATION",
  // Payment collected.
  COMPLETED: "COMPLETED",
  // Payment canceled or rejected, buyer was not charged.
  CANCELED: "CANCELED",
});

export function isAwaitingPayment(status) {
  return status === PayUOrderStatus.NEW || status === PayUOrderStatus.PENDING;
}

export function hasBuyerPaid(status) {
  return (
    status === PayUOrderStatus.COMPLETED ||
    status === PayUOrderStatus.WAITING_FOR_CONFIRMATION
  );
}
