# AdeHQ Control → Commerce

**Status:** locked  
**Date:** 17 July 2026

## Areas

1. Plan catalog  
2. Plan version editor  
3. Promotion manager  
4. Subscription inspector  
5. Economics dashboard (+ top-up catalog)  

There is **no Edit live** button for published customer terms.

## CommerceAdminRole

| Role | Capabilities |
|------|----------------|
| `commerce_viewer` | View catalog and economics (privacy-safe) |
| `support_operator` | Limited goodwill WH grants (capped) |
| `promotion_manager` | Create/edit promo drafts |
| `billing_operator` | Cancel / repair subscription sync |
| `catalog_editor` | Create plan version drafts |
| `catalog_approver` | Publish price/WH/feature changes |
| `finance_admin` | Revenue, provider cost, lawful refunds |
| `platform_owner` | Override safeguards |

Platform admins map to these roles via `platform_admin_commerce_roles` (default: platform owner for existing superadmins).

## High-risk actions

Require: reauthentication, typed confirmation, reason, ticket/reference, second approval (or typed dual confirmation for founding team), immutable audit event.

High-risk: price changes, weekly WH changes, paid feature removals, billing cadence changes, existing-customer migrations, large promo exposure, lawful refunds, safeguard overrides.

## Publish dry-run

Before publish, show:

- Affected new / existing customers  
- Expected provider objects  
- Max promotional WH liability  
- Projected revenue / variable cost / margin  
- First customer impact date  
- Required notices  

Example:

```text
238 subscriptions remain grandfathered
41 migrate at renewal
0 lose features immediately
3 provider prices need creation
Projected maximum promo cost: $1,842
```

## Subscription inspector

Search by workspace, owner email, provider customer, subscription id, plan, promo code.

Actions: schedule migration, grant goodwill WH, revoke fraudulent promo, extend grace, cancel (paid-through), pause execution, repair provider sync — all audited.

## Existing-customer policies on publish

- New customers only  
- Migrate at next renewal  
- Immediate benefits only (equal-or-better)  
- Scheduled explicit migration  
