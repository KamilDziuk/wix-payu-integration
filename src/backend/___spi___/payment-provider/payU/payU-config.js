import { PayUEnabled, isTest } from 'backend/payU/payU-env';

export function getConfig() {
  console.log(`PayU getConfig - ${PayUEnabled ? "enabled" : "disabled: transactions will be rejected"}`);
  return {
    title: isTest() ? 'PayU [TEST ONLY - NOT REAL PAYMENT]' : 'PayU',
    paymentMethods: [
      {
        hostedPage: {
          title: "PayU - BLIK / Karta / Przelew",
          billingAddressMandatoryFields: ['ZIPCODE', 'CITY', 'STATE', 'ADDRESS', 'COUNTRY_CODE', 'EMAIL', 'FIRST_NAME', 'LAST_NAME', 'STREET', 'HOUSE_NUMBER'],
          logos: {
            white: {
              svg: "https://commons.wikimedia.org/wiki/Special:FilePath/PayU.svg",
              png: "https://commons.wikimedia.org/wiki/Special:FilePath/PayU.svg?width=300",
            },
            colored: {
              svg: "https://commons.wikimedia.org/wiki/Special:FilePath/PayU.svg",
              png: "https://commons.wikimedia.org/wiki/Special:FilePath/PayU.svg?width=300",
            },
          },
        },
      },
    ],
    credentialsFields: [
      {
        simpleField: {
          name: "payUPosId",
          label: "PayU POS ID",
        },
      },
    ],
  };
}
