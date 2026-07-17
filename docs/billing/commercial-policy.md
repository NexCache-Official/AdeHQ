# AdeHQ Commercial Policy

**Status:** locked for implementation  
**Date:** 17 July 2026

## Summary

Customers buy a **weekly Work Hours entitlement** and pay **monthly or annually**. Billing anniversary and usage periods are independent clocks.

## Catalog (launch)

| Plan | Weekly WH | Monthly (USD) | Annual (USD) |
|------|----------:|--------------:|-------------:|
| Free | 10 | $0 | — |
| Pro | 125 | $19 | $199 |
| Team | 250 | $39 | $399 |
| Business | 650 | $99 | $999 |
| Enterprise | Contracted | Custom | Custom |

## Dual clocks

### Billing clock

- Anchor: first successful paid activation.
- Monthly: same calendar day next month (clamp short months).
- Annual: same date next year.
- Owns: invoices, renewals, cancel paid-through date, commercial downgrade effectivity, payment status.
- Never grants or resets WH.

### Usage clock

- Period: exactly 168 hours.
- Paid anchor: `floor_to_hour(paid_activation_at)`.
- Free anchor: `floor_to_hour(workspace_created_at)`.
- Free→Paid: re-anchor; no Free WH carryover.
- Monthly/annual renewal: no effect on usage.

## Cancellation

1. Cancel Revolut subscription immediately (no future cycles).
2. Keep AdeHQ paid features until already-paid `billing_period_end` (`service_access_ends_at`).
3. Then demote to Free with a new Free usage anchor.
4. Purchased WH lots remain subject to their expiry policy.

## Upgrades

- Immediate on payment / plan-change confirmation.
- Usage clock unchanged; period snapshot immutable.
- Ledger adjustment grant: `newWeekly − oldWeekly` for the open period.

## Downgrades

- Lower price from next billing renewal (`commercial_change_effective_at`).
- Lower weekly allowance at the first usage-period boundary on or after that renewal.
- No mid-period snapshot mutation; no clawback of past consumption.

## Overdue payment

- During grace (default 7 days): current-period WH and purchased lots remain usable.
- No new paid weekly base grant while overdue.
- Optional one-time `past_due_grace_wh` lot (default 10) per delinquency episode.
- After grace unpaid: AI execution read-only; messaging/history/billing/top-ups remain.
- Payment success resumes normal grants at the next boundary (no backfill).

## Rollover and consumption

- Included weekly WH: no rollover.
- Purchased / top-up WH: 12-month expiry, FIFO by expiry.
- Consumption order: weekly base → weekly promo → one-time promo (FIFO) → purchased (FIFO).

## Refunds

Payments are non-refundable except where required by applicable law or expressly stated in the subscription terms accepted at checkout.

Term sets: `b2b_workspace` | `consumer_individual` | `enterprise_negotiated`.

## Currency and tax (launch)

- USD price book only; no FX at checkout.
- Amounts charged as listed; tax lines added on invoices when legally required.
- B2B workspace launch first; consumer path reserved pending legal review.

## Anti-farming

One WH-bearing Free workspace per verified owner. Additional Free workspaces may exist without separate weekly allowances.
