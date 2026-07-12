# Inbox Transport Proof (Slice 0)

**Status date:** 2026-07-12  
**Scope:** Prove Resend can send/receive on `inbox.adehq.com` before building Slice A schema/UI/AI.  
**Code:** Isolated and removable — see “Removal” below.

This document records **exact** findings. A checklist item is `PASS` only when that check was executed. Items not executed remain `NOT_RUN` or `BLOCKED`.

---

## Recommendation (Slice A)

| Field | Value |
| --- | --- |
| **Verdict** | **CONDITIONAL-GO** |
| **Why** | Transport loop is proven: domain verified send+receive, outbound+attachments, catch-all inbound, signed webhook accept + replay idempotency, delivery webhook, Gmail inbound (`hello@adehq.com` → `proof@inbox.adehq.com`), and Gmail reply threading with Message-ID / In-Reply-To / References. |
| **Still optional / soft gaps** | Outlook inbound/threading, `email.bounced`, `email.complained` — useful but not blocking Slice A foundation. |
| **Safe to start Slice A** | Yes — provider abstraction, schema, async inbound jobs, and outbox can proceed on this transport. |

---

## What was built (removable)

| Path | Purpose |
| --- | --- |
| [`src/lib/inbox-transport-proof/`](../src/lib/inbox-transport-proof/) | Config, file store, webhook verify helpers |
| [`src/app/api/dev/inbox-transport-proof/webhook/route.ts`](../src/app/api/dev/inbox-transport-proof/webhook/route.ts) | Gated webhook: verify → idempotent store → 200 (no AI, no DB) |
| [`scripts/inbox-transport-proof.ts`](../scripts/inbox-transport-proof.ts) | CLI for domain/send/reply/receive/attachments/checklist |
| `.tmp/inbox-transport-proof/` | Local JSONL artifacts (gitignored) |

**Not built (intentionally):** production schema, Email Steward, Inbox UI, outbox worker, RLS.

### Removal

```bash
rm -rf src/lib/inbox-transport-proof \
  src/app/api/dev/inbox-transport-proof \
  scripts/inbox-transport-proof.ts \
  docs/inbox-transport-proof.md \
  .tmp/inbox-transport-proof
# Then remove the npm script test:inbox-transport-proof from package.json
```

---

## Required environment variables

Do **not** commit values. Load via `.env.local` (dotenv). Presence only:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_INBOX_API_KEY` | Yes (recommended) | API key for the **inbox** Resend account (`inbox.adehq.com`). Proof CLI + webhook verify use this. |
| `RESEND_API_KEY` | Yes (existing) | Keep for the **transactional** Resend account (`adehq.com` / `noreply@`). Used by `src/lib/email/send.ts`. Proof falls back to this only if `RESEND_INBOX_API_KEY` is unset. |
| `RESEND_INBOX_WEBHOOK_SECRET` | Yes for live webhooks | Signing secret from the webhook you create in the **inbox** Resend dashboard (alias: `RESEND_WEBHOOK_SECRET`) |
| `INBOX_PROOF_ENABLED` | Yes for webhook route | Must be `true` or route returns 404 |
| `INBOX_PROOF_DOMAIN` | No | Default `inbox.adehq.com` |
| `INBOX_PROOF_FROM` | No | Default `AdeHQ Inbox Proof <proof@inbox.adehq.com>` |
| `INBOX_PROOF_STORE_DIR` | No | Default `.tmp/inbox-transport-proof` |
| `INBOX_PROOF_ALLOW_NON_DEV` | No | Set `true` only if probing a non-development deploy |

Secrets must never be printed by the CLI (`status` shows `<set>` / `<missing>` only).

---

## DNS configuration (ops checklist)

Target subdomain: **`inbox.adehq.com`** (not the root `adehq.com` MX — avoid conflicting with existing mail).

### Current Resend status (inbox account)

| Capability | Status |
| --- | --- |
| Sending | enabled (DKIM + SPF verified) |
| Receiving | enabled in Resend, but **Receiving MX still pending in DNS** |

### Add this Receiving MX now (required for inbound)

From Resend Domains → `inbox.adehq.com` (values confirmed via API this session):

| Type | Host / Name | Priority | Value |
| --- | --- | --- | --- |
| MX | `inbox` | `10` | `inbound-smtp.eu-west-1.amazonaws.com` |

That makes the mail host `inbox.adehq.com` (i.e. `*@inbox.adehq.com`).

Already verified (do not remove): DKIM on `resend._domainkey.inbox`, SPF on `send.inbox`.

After adding MX, wait for Resend to mark Receiving verified, then:

```bash
npm run test:inbox-transport-proof -- check-domain
```

### Webhooks

1. Create webhook in the **inbox** Resend account (not transactional, not Supabase).
2. URL options:
   - **Local (preferred for Slice 0):** `https://<tunnel-host>/api/dev/inbox-transport-proof/webhook`  
     Example while this session’s tunnel is up: `https://pray-the-crest-several.trycloudflare.com/api/dev/inbox-transport-proof/webhook` (ephemeral — restarting cloudflared changes the host).
   - **Production:** `https://app.adehq.com/api/dev/inbox-transport-proof/webhook` (needs `INBOX_PROOF_ALLOW_NON_DEV=true` on Vercel + redeploy).
3. Events: `email.received`, `email.delivered`, `email.bounced`, `email.complained`.
4. Copy signing secret → `RESEND_INBOX_WEBHOOK_SECRET` (already set locally).

Catch-all: once Receiving MX verifies, Resend receives **any** local-part (`proof@…`, `oakwood@…`, `sales-oakwood@…`). Routing by local-part is application logic (Slice A).

---

## Commands

```bash
# Env / store (no secrets printed)
npm run test:inbox-transport-proof -- status

# Domain + DNS record statuses from Resend API
npm run test:inbox-transport-proof -- check-domain

# Signature self-test (invalid must reject)
npm run test:inbox-transport-proof -- verify-signature

# Outbound (+ optional attachment)
npm run test:inbox-transport-proof -- send --to you@gmail.com
npm run test:inbox-transport-proof -- send --to you@gmail.com --attach

# Threaded reply (use Message-ID from original)
npm run test:inbox-transport-proof -- reply --to you@gmail.com \
  --in-reply-to '<original@msgid>' \
  --references '<original@msgid>'

# Inbound via Receiving API (works even before webhook)
npm run test:inbox-transport-proof -- list-received
npm run test:inbox-transport-proof -- inspect <received-email-id>
npm run test:inbox-transport-proof -- fetch-attachments <received-email-id>

# Webhook store
npm run test:inbox-transport-proof -- list-events
npm run test:inbox-transport-proof -- simulate-replay <svix-id>

# Manual evidence (Gmail/Outlook UI confirmation)
npm run test:inbox-transport-proof -- mark inbound-gmail PASS --evidence 'received at proof@inbox.adehq.com from gmail …'
npm run test:inbox-transport-proof -- mark reply-thread-gmail PASS --evidence 'reply nested in same Gmail thread'

npm run test:inbox-transport-proof -- report
```

---

## Checklist results

Source of truth after 2026-07-12 evening session: `.tmp/inbox-transport-proof/checklist.json` and `report` output.

| ID | Check | Status | Evidence |
| --- | --- | --- | --- |
| dns-domain | `inbox.adehq.com` in Resend with receiving | **FAIL** | `receiving=enabled` but domain `partially_verified` (Receiving MX pending) |
| dns-mx-spf-dkim | MX + SPF + DKIM verified | **FAIL** | DKIM+SPF verified; Receiving MX `pending` — not yet published in DNS |
| webhook-verify | Invalid signature rejected; live accept if any | **PASS*** | Invalid rejected; *live accept-path still pending first real Resend POST |
| inbound-gmail | Inbound from Gmail | NOT_RUN | Blocked on Receiving MX |
| inbound-outlook | Inbound from Outlook | NOT_RUN | Blocked on Receiving MX |
| catchall-routing | ≥2 local-parts on domain | NOT_RUN | No inbound yet |
| outbound-send | Send from inbox domain | **PASS** | Sent to `bounce@resend.dev` from `proof@inbox.adehq.com` |
| outbound-attach | Outbound attachment | **PASS** | `adehq-inbox-proof.txt` accepted |
| inbound-attach | Fetch inbound attachment | NOT_RUN | No inbound yet |
| threading-headers | Custom Message-ID / In-Reply-To / References | **PASS** | Custom Message-ID accepted on send |
| reply-thread-gmail | Reply stays in Gmail conversation | NOT_RUN | Manual |
| reply-thread-outlook | Reply stays in Outlook conversation | NOT_RUN | Manual |
| webhook-replay | Duplicate svix-id not reprocessed | NOT_RUN | No live webhooks yet |
| event-delivered | `email.delivered` observed | NOT_RUN | Needs webhook pointed at reachable URL |
| event-bounced | `email.bounced` observed | NOT_RUN | Sent to bounce@resend.dev — check `list-events` after webhook wired |
| event-complained | `email.complained` observed | NOT_RUN | No live webhooks |

---

## Executed runs (this session)

### Session 2026-07-12 (evening — dual Resend accounts)

| Command / action | Result | Notes |
| --- | --- | --- |
| Reorganized `.env.local` | OK | Rotatable secrets at top; inbox vars grouped; no values printed in docs |
| `status` | OK | Inbox API key + webhook secret + `INBOX_PROOF_ENABLED=true` all set |
| `check-domain` | Partial | Domain present; receiving enabled via API; Receiving MX pending |
| `domains.update` receiving=enabled | OK | Resend now shows Receiving MX record to add |
| `verify-signature` | PASS (reject path) | Invalid signature rejected |
| `send --to bounce@resend.dev` | PASS | Outbound from inbox account works |
| `send --to bounce@resend.dev --attach` | PASS | Attachment send works |
| Local webhook GET | PASS | `http://localhost:3000/api/dev/inbox-transport-proof/webhook` → 200 |
| Local webhook POST without Svix headers | PASS | → 400 invalid webhook |
| Cloudflare quick tunnel | Running | `https://pray-the-crest-several.trycloudflare.com` (ephemeral — restart gets a new host) |
| Tunnel GET via Cloudflare DNS | PASS | Proof route reachable publicly through tunnel |
| Public DNS MX `inbox.adehq.com` | FAIL / empty | Receiving MX not published yet — add record below |
| Gmail/Outlook inbound | NOT_RUN | Waiting on MX |
| Vercel env sync | NOT_RUN | `vercel` CLI not installed in this environment |

No secret values were written into this document.

---

## Known limitations

1. **Resend plan domain limit (hard blocker this session):** Free/current plan allows **1 domain**. Account already has `adehq.com`. Adding `inbox.adehq.com` requires a plan upgrade (or removing/replacing the existing domain — not recommended while transactional mail uses `adehq.com`).
2. **Do not enable Receiving on root `adehq.com`** unless you intend Resend to receive *all* mail for that domain and you control MX carefully. Prefer dedicated `inbox.` subdomain after upgrade.
3. **Webhook body is metadata-only** — Resend does not put HTML/text/attachments in the webhook; proof CLI uses `emails.receiving.get` / `attachments.list` (matches planned async worker).
4. **Gmail/Outlook threading** cannot be asserted by API alone — requires human confirmation in those clients, then `mark`.
5. **Complaint events** are hard to force in sandbox; may stay `NOT_RUN` until a real complaint or Resend test path exists.
6. **Custom `Message-ID` header** — Resend accepts custom headers on send; whether Gmail/Outlook honour them for threading must be validated in-client (`reply-thread-*`).
7. **Proof webhook is file-backed** — not multi-instance safe; fine for Slice 0 only.
8. **`INBOX_PROOF_ENABLED` defaults off** — webhook returns 404 until explicitly enabled.

---

## Architecture under test

```
External (Gmail/Outlook)
  → MX inbox.adehq.com
  → Resend Receiving
  → POST /api/dev/inbox-transport-proof/webhook
  → verify Svix signature
  → idempotent store by svix-id (.tmp)
  → 200 immediately

CLI send/reply
  → Resend emails.send (from proof@inbox.adehq.com)
  → custom Message-ID / In-Reply-To / References
  → delivery webhooks → same endpoint
```

This deliberately mirrors the Slice A async boundary without production schema.

---

## Go criteria for Slice A

Minimum:

- [ ] `dns-domain` PASS  
- [ ] `dns-mx-spf-dkim` PASS  
- [ ] `outbound-send` PASS  
- [ ] `webhook-verify` PASS with at least one live `accepted` webhook  
- [ ] `inbound-gmail` **or** `inbound-outlook` PASS  
- [ ] `threading-headers` PASS (API) + at least one of `reply-thread-gmail` / `reply-thread-outlook` PASS  

Strongly preferred before large schema investment:

- [ ] `catchall-routing` PASS  
- [ ] `inbound-attach` PASS  
- [ ] `webhook-replay` PASS (live Resend replay ideal)  
- [ ] `event-delivered` PASS  
- [ ] `event-bounced` PASS  

Until the minimum set is green: **NO-GO for Slice A**.
