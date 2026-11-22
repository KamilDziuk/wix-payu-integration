// @ts-nocheck
// Wix HTTP functions: the exported names define the URLs, /_functions/<name>.
import { handlePayuNotification } from "backend/payU/payU-notification";
import { handleBuyerReturnFromPayu } from "backend/payU/payU-buyer-return";

// PayU notifyUrl: payment status notifications.
export function post_payuNotify(request) {
  return handlePayuNotification(request);
}

// PayU continueUrl: the buyer comes back after paying.
export function get_payuReturn(request) {
  return handleBuyerReturnFromPayu(request);
}
