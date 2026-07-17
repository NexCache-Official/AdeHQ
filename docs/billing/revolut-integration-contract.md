# AdeHQ Revolut Integration Contract

**Status:** locked  
**Date:** 17 July 2026

## API version pin

```text
REVOLUT_MERCHANT_API_VERSION=2026-04-20
```

Also accepted as `REVOLUT_API_VERSION` for backward compatibility. All subscription operations must send `Revolut-Api-Version`.

## Source of truth

| Concern | Owner |
|---------|--------|
| Catalog, entitlements, usage, ledger, service access | AdeHQ DB |
| Payment collection, saved method, recurring charge, provider_status | Revolut |

## Deterministic provider references

```text
adehq:{environment}:{planCode}:v{version}:{currency}:{cadence}
```

## Provider-sync saga

```text
draft → validation_passed → provider_sync_pending → provider_synced
→ scheduled → published

Failures: provider_sync_failed | publication_failed | verification_failed
```

A price is checkout-selectable only when Revolut plan + variation exist, retrieve verifies currency/amount, mapping is persisted, and AdeHQ status is published.

## Subscription checkout (HPP)

1. Create/get Revolut customer.  
2. `POST /api/subscriptions` with `plan_variation_id`, `customer_id`, `external_reference`, `setup_order_redirect_url`.  
3. Retrieve setup order → `checkout_url`.  
4. Customer pays; payment method saved.  
5. Webhook + authoritative retrieve → activate once (`subscription-activation:{revolutSubId}`).

## Cancel semantics

Revolut cancel is **immediate** (no future cycles). AdeHQ sets:

- `provider_status = cancelled`
- `service_access_status = scheduled_to_end`
- `service_access_ends_at = billing_period_end`

## Webhooks

1. Verify signature.  
2. Deduplicate event id.  
3. Re-fetch subscription/order (never trust payload alone; never assume order).  
4. Apply state transition.  
5. Ack 200 only after durable write.

Subscribe at minimum to order completion/authorisation and subscription lifecycle events available for the pinned API version.

## Reconciliation worker

Periodically re-fetch provider state for subscriptions that are pending, overdue, scheduled_to_end, recently cancelled, or have pending commercial changes.

## Contract tests

Automated coverage required for:

- create customer  
- create subscription  
- retrieve subscription  
- retrieve current cycle  
- cancel subscription  
- change plan  
- payment failure path  
- webhook verification  

## Env vars

| Variable | Notes |
|----------|--------|
| `REVOLUT_MERCHANT_API_KEY` | Server-only |
| `REVOLUT_WEBHOOK_SECRET` | HMAC verify |
| `REVOLUT_ENVIRONMENT` | `sandbox` \| `production` |
| `REVOLUT_MERCHANT_API_VERSION` / `REVOLUT_API_VERSION` | Pin `2026-04-20` |
| `REVOLUT_CURRENCY` | Launch `USD` |
