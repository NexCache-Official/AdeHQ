# AdeHQ Commerce Domain and Ledger

**Status:** locked  
**Date:** 17 July 2026

## Domain hierarchy

```text
Plans → immutable plan versions → prices → entitlements
→ subscriptions → usage periods → promotions → credit wallets → ledger
→ reservations
```

## Core tables

| Table | Role |
|-------|------|
| `billing_plans` | Stable identity (`free`/`pro`/`team`/`business`/`enterprise`) |
| `billing_plan_versions` | Immutable once published; presentation + entitlement pin |
| `billing_prices` | Currency + cadence amount + Revolut mapping + sync state |
| `billing_plan_entitlements` | Typed key/value matrix per version |
| `billing_checkout_snapshots` | Frozen accepted terms at checkout |
| `billing_subscriptions` | Provider + service access + pending changes |
| `workspace_usage_periods` | Immutable 168h snapshots |
| `wh_credit_lots` | Purchased / promo / goodwill lots with expiry |
| `wh_ledger_entries` | Append-only balance changes |
| `wh_reservations` | Concurrent run holds |
| `wh_topup_products` | Versioned top-up SKUs |
| `billing_promotions` | Campaign overlays |
| `billing_provider_sync_jobs` | Outbox for Revolut catalog sync |

## Provider vs service access

```ts
provider_status: pending | active | overdue | paused | cancelled | finished
service_access_status: active | grace | scheduled_to_end | read_only | free
```

Never map `provider_status = cancelled` to immediate Free.

## Usage periods

- Immutable after open: do not mutate base grant in place.
- Upgrade: add `upgrade_allowance_adjustment` ledger entry.
- Downgrade WH: apply at `usage_change_effective_period_start`.
- Idempotency key: `workspace:{id}:usage-period:{startIso}`.

## Reservations

```text
estimate → reserve atomically → run → settle actual → release unused
```

Available WH = grants − settled debits − active (non-expired) reservations.

## Ledger entry types

`weekly_base_grant` | `weekly_promo_grant` | `purchased_grant` | `goodwill_grant` | `upgrade_allowance_adjustment` | `usage_debit` | `reservation_hold` | `reservation_release` | `expiration` | `refund_compensation` | `manual_adjustment` | `past_due_grace_grant`

Every balance change appends a row. Manual adjustments require reason, actor, optional ticket.

## Consumption order

1. Weekly included WH  
2. Weekly promotional WH  
3. One-time promotional credits (earliest expiry first)  
4. Purchased WH (earliest expiry first)

## Top-ups

Versioned products only (launch: 100 / 500 / 1,500 WH). Ordinary UI must not accept arbitrary charge+WH pairs.
