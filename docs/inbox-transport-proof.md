# Inbox Transport Proof (Slice 0)

**Status date:** 2026-07-13  
**Scope:** Prove Resend can send/receive on `inbox.adehq.com` before building Slice A schema/UI/AI.  
**Code:** Isolated proof tooling remains under `src/lib/inbox-transport-proof/` (removable).

This document records findings. Core transport is **GO** based on live production use of the workspace inbox.

---

## Recommendation

| Field | Value |
| --- | --- |
| **Verdict** | **GO** |
| **Why** | Live confirmation: AdeHQ workspace inbox **sends to and receives from both Gmail and Outlook** (both directions). Domain DNS, Resend receiving, product webhook, and outbox path are in production use. |
| **Soft / optional gaps** | Formal scripted bounce/complaint event capture; automated webhook-replay checklist row; attachment round-trip UI (product work, not transport). |
| **Slices A–C** | Proceeded on this transport; foundation and AI steward are shipped. |

---

## Checklist results (updated)

| ID | Check | Status | Evidence |
| --- | --- | --- | --- |
| dns-domain | `inbox.adehq.com` in Resend with receiving | **PASS** | Live inbound working |
| dns-mx-spf-dkim | MX + SPF + DKIM verified | **PASS** | Live send+receive working |
| webhook-verify | Invalid signature rejected; live accept | **PASS** | Production `/api/inbox/webhooks/resend` |
| inbound-gmail | Inbound from Gmail | **PASS** | User-confirmed live receive AdeHQ ← Gmail |
| inbound-outlook | Inbound from Outlook | **PASS** | User-confirmed live receive AdeHQ ← Outlook |
| outbound-send | Send from inbox domain | **PASS** | User-confirmed live send AdeHQ → Gmail/Outlook |
| outbound-gmail | Outbound lands in Gmail | **PASS** | User-confirmed |
| outbound-outlook | Outbound lands in Outlook | **PASS** | User-confirmed |
| reply-thread-gmail | Reply stays in conversation | **PASS** | Live product use |
| reply-thread-outlook | Reply stays in conversation | **PASS** | Live product use |
| threading-headers | Message-ID / In-Reply-To / References | **PASS** | Product outbox + inbound threading |
| catchall-routing | Multiple local-parts | **PASS** | Claim-first addresses on catch-all |
| webhook-replay | Duplicate svix-id not reprocessed | **PASS*** | Idempotent store by `svix_id` / provider id (*scripted replay optional) |
| event-delivered | `email.delivered` observed | Soft | Delivery webhooks wired in product; formal checklist optional |
| event-bounced | `email.bounced` observed | Soft | Delivery + DSN handlers present; formal checklist optional |
| event-complained | `email.complained` observed | Soft | Handler present; hard to force in sandbox |

---

## What was built (removable proof tooling)

| Path | Purpose |
| --- | --- |
| [`src/lib/inbox-transport-proof/`](../src/lib/inbox-transport-proof/) | Config, file store, webhook verify helpers |
| [`src/app/api/dev/inbox-transport-proof/webhook/route.ts`](../src/app/api/dev/inbox-transport-proof/webhook/route.ts) | Gated proof webhook |
| [`scripts/inbox-transport-proof.ts`](../scripts/inbox-transport-proof.ts) | CLI |

Production path (not removable): `/api/inbox/webhooks/resend`, `src/lib/inbox/**`.

---

## Go criteria for Slice A

Minimum (all met via live use):

- [x] `dns-domain` PASS  
- [x] `dns-mx-spf-dkim` PASS  
- [x] `outbound-send` PASS  
- [x] `webhook-verify` PASS  
- [x] `inbound-gmail` **and** `inbound-outlook` PASS  
- [x] Threading / reply in client PASS  

**Verdict: GO** — Slice 0 core transport is closed.
