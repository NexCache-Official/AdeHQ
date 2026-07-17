# Revolut billing setup

AdeHQ uses **Revolut Merchant** as the only payment provider. Paid plans use **native Revolut Subscriptions** (auto-renew until cancelled). Top-ups use one-time orders.

## Locked docs

1. [commercial-policy.md](./commercial-policy.md)
2. [plan-entitlement-matrix-v1.md](./plan-entitlement-matrix-v1.md)
3. [commerce-domain-ledger.md](./commerce-domain-ledger.md)
4. [revolut-integration-contract.md](./revolut-integration-contract.md)
5. [promotions-and-offers.md](./promotions-and-offers.md)
6. [control-commerce.md](./control-commerce.md)

## Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `REVOLUT_MERCHANT_API_KEY` | Yes | Merchant API secret (server-only) |
| `REVOLUT_WEBHOOK_SECRET` | Yes in production | Verifies webhook HMAC |
| `REVOLUT_ENVIRONMENT` | No | `sandbox` (default) or `production` |
| `REVOLUT_MERCHANT_API_VERSION` | Yes | Pin `2026-04-20` (`REVOLUT_API_VERSION` accepted) |
| `REVOLUT_CURRENCY` | No | ISO currency, default `USD` |
| `NEXT_PUBLIC_APP_URL` | Yes for redirects | Public app origin |

## Webhooks

```text
https://<your-host>/api/billing/revolut/webhook
```

Subscribe to order completion/authorisation and subscription lifecycle events for the pinned API version. Fulfilment is state-based and idempotent; a reconciliation worker re-fetches provider state for pending/overdue/recently cancelled subscriptions.

## How subscribe works

1. Admin starts checkout from **Settings → Billing**.
2. AdeHQ freezes a checkout snapshot, syncs/selects a published price with Revolut variation, creates a Revolut subscription (HPP).
3. Customer pays; payment method is saved for recurring cycles.
4. Webhook + authoritative retrieve activates AdeHQ service access and the usage clock.

## Cancellation

Revolut cancel is immediate (no new cycles). AdeHQ keeps paid access until `service_access_ends_at` (already-paid billing period end).

## Verify

- Platform admin → **Commerce / Billing** shows Revolut readiness and provider sync health.
- Sandbox: complete a test subscribe; billing page should show plan, next invoice, and usage period.

See also [`.env.example`](../../.env.example).
