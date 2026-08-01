#  PayU Payment Provider Service Plugin - Wix Velo

A custom **PayU (BLIK / Card / Bank Transfer)** payment integration for [kulikstyle.com](https://www.kulikstyle.com), built as a **Wix Payment Provider Service Plugin** in Velo, after discovering that the native Wix <-> PayU integration didn't support BLIK.

![Status](https://img.shields.io/badge/status-live%20in%20production-brightgreen)
![Platform](https://img.shields.io/badge/platform-Wix%20Velo-blue)
![Payment](https://img.shields.io/badge/payments-PayU%20%7C%20BLIK-orange)

---



![Payment](https://lh3.googleusercontent.com/d/1PrPteCbmvSdUA2Vt1S8AGS8_p8EQfexj)




## Why this project exists

Wix's native PayU integration (available under **Accept Payments**) only renders **card fields** at checkout - it never redirects to PayU's hosted payment page, so **BLIK, the most widely used payment method in Poland, never shows up**. The same turned out to be true for Wix's native Fondy integration.

The fix: a custom **Payment Provider Service Plugin** that talks directly to the PayU REST API, exposing the full range of PayU payment methods (BLIK, card, instant bank transfer) as a native option on Wix checkout.

## How it works

```
Customer -> Wix Checkout → selects "PayU - BLIK / Card / Bank Transfer"
        -> createTransaction() creates an order via PayU REST API v2.1
        -> customer is redirected to PayU's hosted payment page
        -> pays (BLIK / card / bank transfer)
        -> PayU sends a webhook (payuNotify) -> submitEvent() -> Wix eCommerce
        -> order is marked as paid, inventory updates automatically
```

## Project structure

```
src/backend/
├── ___spi___/payment-provider/payu/
│   ├── payu-config.js   # payment method config (getConfig)
│   └── payu.js          # connectAccount / createTransaction / refundTransaction
└── http-functions.js    # payuNotify webhook - receives PayU payment confirmations
```

## Credentials & secrets

**No API keys or credentials are ever hardcoded in the source files.** All sensitive values are stored in **Wix Secrets Manager** and read at runtime via `wix-secrets-backend`:

| Secret name           | Purpose                                   |
|------------------------|--------------------------------------------|
| `PAYU_CLIENT_ID`       | OAuth client ID for PayU REST API           |
| `PAYU_CLIENT_SECRET`   | OAuth client secret for PayU REST API       |
| `PAYU_POS_ID`          | PayU Point of Sale (merchant) ID            |

The `posId` entered by the site owner on the **Connect PayU** screen in the Wix dashboard is also passed through `connectAccount()` and stored as part of the connected account's credentials - it is never exposed client-side.

If you fork/reuse this plugin, add these three secrets in **Dev Mode -> Secrets Manager** before connecting the payment provider, or `getPayuToken()` will throw at runtime.

##  Features

- **BLIK, card, instant bank transfer** - the full set of PayU payment methods, available directly on Wix checkout.
- **OAuth 2.0** - secure authentication against the PayU API (client credentials grant).
- **Automatic order updates** - the `payuNotify` webhook integrates with `wix-payment-provider-backend`, so orders, inventory, and statuses update exactly like they would with a native payment method.
- **Fraud-check data** - the real customer IP is forwarded to PayU (`fraudInformation.remoteIp`) for risk scoring.
- **Amounts in grosz (minor units)** - correctly converted per PayU API requirements.
- **Secrets isolated from source code** - see [Credentials & secrets](#-credentials--secrets) above.

## The tricky part

The plugin silently refused to register in Accept Payments for a long time, despite fully working, test-passing code. Root cause: `getConfig()` returned `paymentMethods` as a plain object `{ hostedPage: {...} }` instead of the **array** `[{ hostedPage: {...} }]` required by Wix's schema, and `logos` used a `url` key instead of the required `svg`/`png` keys. The schema mismatch caused a **silent registration failure** with no readable error - the code passed all functional tests (since those only check JS syntax), but failed schema validation at publish time.

## Stack

- **Wix Velo** (Payment Provider Service Plugin)
- **Wix CLI + Git Integration** - local development in VS Code
- **PayU REST API v2.1** (OAuth 2.0, Orders API, Notifications)


---

*Built with persistence, a lot of debugging, and one very helpful line in the official Wix docs. -
[Wix payment provider service plugin](https://dev.wix.com/docs/develop-websites/articles/code-tutorials/wix-pay/tutorial-payment-provider-service-plugin)

