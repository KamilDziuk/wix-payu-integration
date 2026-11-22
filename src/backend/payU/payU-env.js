export const PayUEnabled = true;
export const PayUEnvironment = 'test'; // or 'prod'

export const PayUTestPointOfSalesId = "145227";
export const PayUTestClientId = "145227";
export const PayUTestClientSecret = "12f071174cb7eb79d4aac5bc2f07563f";
export const PayUTestSecondKey = "13a980d4f851f3d9a1cfc792fb1f5e50";

export const PayUAuthUrl = "https://secure.payu.com/pl/standard/user/oauth/authorize";
export const PayUOrdersUrl = "https://secure.payu.com/api/v2_1/orders/";
export const PayUNotifyUrl = "https://www.agnieszkalozinska.com/_functions/payuNotify";
export const PayUReturnUrl = "https://www.agnieszkalozinska.com/_functions/payuReturn";
// Fallback when the Wix return URLs are unknown.
export const PayUContinueUrl = "https://www.agnieszkalozinska.com/thank-you-page";

export function getPayUContinueUrl(orderId) {
    return orderId ? `${PayUContinueUrl}/${orderId}` : PayUContinueUrl;
}

export function isTest() {
    return PayUEnvironment === 'test';
}