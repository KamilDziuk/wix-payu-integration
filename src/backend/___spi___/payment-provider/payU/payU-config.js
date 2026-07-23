export function getConfig() {
  return {
    title: "PayU",
    paymentMethods: [
      {
        hostedPage: {
          title: "PayU - BLIK / Karta / Przelew",
          billingAddressMandatoryFields: ["EMAIL", "COUNTRY_CODE"],
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
          name: "posId",
          label: "PayU POS ID",
        },
      },
    ],
  };
}