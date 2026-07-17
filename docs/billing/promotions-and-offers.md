# AdeHQ Promotions and Offers

**Status:** locked  
**Date:** 17 July 2026

## Principle

Promotions are overlays. Never mutate a published plan version to create a deal.

## Enforcement classes

| Class | Use |
|-------|-----|
| `adehq_ledger` | Weekly bonus WH, one-time WH, goodwill, temporary feature unlock |
| `revolut_price` | Dedicated discounted variation |
| `revolut_phase` | Introductory billing phases then full price |
| `hybrid` | Revolut money terms + AdeHQ WH rewards |

Checkout must not promise a money discount unless the Revolut object that will be charged reflects that exact amount or phase.

## Reward types

- `weekly_wh_bonus` — extra WH for N usage periods  
- `one_time_wh_credit` — lot with expiry days  
- `percentage_discount` / `fixed_discount` — provider-enforced  
- `feature_unlock` — temporary entitlement overlay  

## Eligibility

- Plan codes, cadences, currencies  
- New customers only / first paid subscription only  
- Max redemptions, max per customer, stackable flag  
- Anti-fraud: workspace + payment customer + verified identity limits  

## Private offers

Plan version `visibility`:

- `public`  
- `invite_only`  
- `workspace_specific`  
- `enterprise_contract`  

Private offers still use immutable versions and prices.

## Upgrade / cancel interactions

- Price discounts stay tied to the eligible price.  
- Bonus WH may follow upgrade when the new plan is eligible; no new redemption on upgrade.  
- On cancel: unused weekly bonus expires at access end; one-time promo per written terms; purchased WH keeps published expiry policy.  

## Top-up products

Versioned SKUs (launch USD): 100 / 500 / 1,500 WH, 365-day expiry. Retire packs by publishing a new version status; do not edit live pack amounts.
