# Revolut billing setup

AdeHQ uses **Revolut Merchant** as the only payment provider. There is no Stripe checkout.

## What you configure

1. Create a Revolut Merchant account (sandbox, then production).
2. Set these environment variables (local `.env.local` and Vercel):

| Variable | Required | Notes |
|----------|----------|--------|
| `REVOLUT_MERCHANT_API_KEY` | Yes | Merchant API secret (server-only) |
| `REVOLUT_WEBHOOK_SECRET` | Yes in production | Verifies webhook HMAC |
| `REVOLUT_ENVIRONMENT` | No | `sandbox` (default) or `production` |
| `REVOLUT_CURRENCY` | No | ISO currency, default `USD` |
| `NEXT_PUBLIC_APP_URL` | Yes for redirects | Public app origin |

3. In Revolut Business → Merchant API → Webhooks, add:

```text
https://<your-host>/api/billing/revolut/webhook
```

Subscribe to `ORDER_COMPLETED` and `ORDER_AUTHORISED`.

## How upgrades work

1. Admin starts checkout from **Settings → Billing**.
2. Browser opens Revolut hosted payment page.
3. Revolut POSTs to our webhook; AdeHQ activates the plan term (`current_plan_started_at` updates).
4. Weekly AI Work Hours allowance refreshes from the new plan.

Renewals are **local plan terms**: AdeHQ stores `current_period_end` and customers re-checkout (or receive an AdeHQ promo / platform override). This release does **not** use Revolut Subscriptions for automatic recurring charges.

## Verify

- Platform admin → **Billing** shows Revolut readiness (key, webhook secret, environment, currency).
- Sandbox: complete a test checkout; billing page should poll until the plan updates.

See also [`.env.example`](../../.env.example).
