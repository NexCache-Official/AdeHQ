# E-Signature & Contract Workflow — Product Plan

**Status:** Proposed, ready to scope for engineering.
**Owner decision needed before build starts:** e-signature provider choice (recommendation below), legal-review gate policy, single vs. per-workspace signing account (see "Open decisions," bottom).

This document is written to be handed directly to a developer. It names the exact
files/patterns to extend in the existing codebase, not a generic integration guide.

---

## 1. Goal

Right now AdeHQ's AI employees can draft a document (PDF/DOCX/spreadsheet) and save it
to Drive — but nothing gets it *signed*. There is no way to take a deal from "AI wrote
the LOI" to "the LOI is legally executed" without leaving the product, emailing a PDF
around manually, and coming back to tell the AI it's done (which it can't verify).

**This feature closes that loop**: an employee drafts a contract, a human reviews and
approves it, it goes out for real e-signature to real parties, signing status is
tracked live in the room and in Drive, and once fully executed the signed PDF and the
linked CRM deal update automatically — with no fabricated "done" claims (the same
honesty guarantee AdeHQ already enforces for CRM/task actions).

This is the single highest-leverage missing capability for the real-estate vertical:
every test session surfaced deals with real deadlines (1031 exchanges, closing dates)
that needed paperwork actually executed, not just drafted.

## 2. Scope

**In scope (v1):**
- Two document types: Letter of Intent (LOI) and a generic, customizable Contract
  template. (Purchase & Sale Agreement is a v1.1 template addition, same mechanism.)
- Draft → human review → send for signature → live status tracking → auto-file the
  signed document → optional CRM deal update on full execution.
- One e-signature provider integration (see §6).

**Explicitly out of scope for v1:**
- No clause library, redlining, or negotiated multi-round contract editing. If the
  terms change, the AI regenerates the document and a new envelope is sent.
- No in-house signature-capture UI or legal-validity engine — wrap a compliant
  third-party provider (ESIGN Act / UETA-compliant audit trail) instead of building one.
- No per-workspace connected signing accounts in v1 (single platform-level account,
  same simplicity as how email/Resend works today) — see open decision #3.

## 3. The core gap today (for context)

- `artifact.createPdfReport` / `artifact.createDocx` (`src/lib/integrations/registry/tool-definitions.ts:490-543`)
  produce flat, print-style documents. No signature field exists anywhere in the
  pipeline.
- CRM deals (`src/lib/crm/types.ts:34-47`) track stage/status but have no concept of
  "is the paperwork signed."
- The only live third-party API integration in the codebase today is transactional
  email via Resend (`src/lib/email/send.ts`) — there is no existing webhook handler to
  copy; this feature builds the first one.

## 4. What artifact exactly the platform needs

Two new concepts, both additive to the existing architecture:

**A. Contract document** — a new `SavedArtifactType` value: `"contract"`
(`src/lib/types.ts:487-499`, mirrored in `ArtifactEffectSchema`,
`src/lib/ai/schemas.ts:51-73`). It's stored exactly like every other artifact —
markdown/JSON content in the `artifacts` table, rendered to PDF through the existing
Playwright pipeline (`src/lib/artifacts/engine/pdf-report.ts`,
`src/lib/artifacts/templates/pdf/index.ts`) — with one addition: the HTML template
embeds **signer anchor tags** at each signature/date/initial location, e.g.:

```html
<span class="sig-anchor">[sig|buyer]</span>
<span class="sig-anchor">[date|buyer]</span>
<span class="sig-anchor">[sig|seller]</span>
```

These exact strings are what the e-signature provider's "text tag" field-placement
feature reads out of the generated PDF to drop real, legally-binding signature fields
at that spot — with no manual coordinate mapping, which matters because every document
is freshly AI-generated, not a fixed template a human maps once in a provider dashboard.

**B. Signature envelope** — the new, stateful, trackable object representing "this
version of this document was sent to these people to sign." This is new data, not an
artifact — see the schema below.

## 5. Data model (new tables)

```sql
-- One row per "send this document out for signature" request.
create table contract_envelopes (
  id                    text primary key,
  workspace_id          uuid not null,
  room_id               text,
  topic_id              text,
  artifact_id           text not null references artifacts(id),   -- source document
  deal_id               text references crm_deals(id),             -- optional CRM link
  created_by_employee_id text,
  provider              text not null,                              -- 'dropbox_sign'
  provider_envelope_id  text,                                       -- external ref
  title                 text not null,
  document_type         text not null,                       -- loi | purchase_agreement | contract
  status                text not null default 'draft',
    -- draft | pending_review | sent | viewed | signed | declined | voided | expired | error
  signed_document_url   text,                                       -- final PDF once complete
  requires_human_review boolean not null default true,
  reviewed_by_user_id   uuid,
  reviewed_at           timestamptz,
  sent_at               timestamptz,
  completed_at          timestamptz,
  error_message         text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One row per signer per envelope.
create table contract_signers (
  id                 text primary key,
  envelope_id        text not null references contract_envelopes(id) on delete cascade,
  role               text not null,     -- buyer | seller | buyer_agent | seller_agent | other
  name               text not null,
  email              text not null,
  order_index        int not null default 0,   -- 0 = parallel / any order
  status             text not null default 'pending', -- pending | sent | viewed | signed | declined
  signed_at          timestamptz,
  provider_signer_id text,
  created_at         timestamptz not null default now()
);

-- Full audit trail — every webhook event, verbatim. Keep this even after
-- deriving envelope/signer status from it; it's the compliance record.
create table contract_envelope_events (
  id           text primary key,
  envelope_id  text not null references contract_envelopes(id) on delete cascade,
  event_type   text not null,  -- sent | viewed | signed | declined | voided | completed
  signer_id    text,
  raw_payload  jsonb,
  created_at   timestamptz not null default now()
);
```

Add `contract_envelopes`/`contract_signers` to the realtime publication + workspace
tables list (`src/lib/supabase/config.ts`) the same way CRM/Tasks already are, so
status updates appear live without a refresh.

## 6. Tool Execution Core additions

New `CapabilityDomain`: `"contract"` (add to the enum at
`src/lib/integrations/types.ts:13-22`).

New adapter file `src/lib/integrations/adapters/adehq-contracts.ts`, following the
exact pattern of `adehq-email.ts` / `adehq-crm.ts` (plain async functions
`(client, ctx, args) => Promise<ToolExecutionOutput>`), registered in
`src/lib/integrations/executor/internal-executor.ts` and in
`src/lib/integrations/registry/tool-definitions.ts`.

| Tool | Mode | Approval | What it does |
|---|---|---|---|
| `contract.draftDocument` | preview/execute | `suggested` | Generates the contract artifact (same risk tier as any other artifact creation — nothing external happens yet). Args: `documentType` (`loi`\|`purchase_agreement`\|`contract`), `title`, `dealId?`, `parties: {role,name,email}[]`, `keyTerms: {label,value}[]`, `effectiveDate?`, `expirationDate?`. |
| `contract.sendForSignature` | preview/execute | **`required`** | Creates the `contract_envelopes` + `contract_signers` rows and calls the provider API to actually send it. Args: `artifactId`, `dealId?`, `signers: {role,name,email,order?}[]`. **Preview must show exactly who gets emailed and what document** — this sends a real, binding-intent email to a real external person; same trust tier as any irreversible external send. |
| `contract.checkStatus` | execute only | none (`readOnly: true`) | Returns live envelope + per-signer status from the DB (kept in sync by the webhook — see §8). Never lets the model guess or claim a status; mirrors the existing honesty-guardrail principle for CRM/task claims. |
| `contract.voidEnvelope` | preview/execute | **`required`** | Cancels a pending envelope (wrong recipient, terms changed) via the provider's void/cancel API. |

Use `tool.approval` exactly as the existing gate already works
(`src/lib/integrations/executor/tool-executor.ts`, `verifyApproval`) — `sendForSignature`
and `voidEnvelope` must require a **verified** approval, not just a preview.

**Compliance guardrail (not optional):** because these are AI-drafted legal documents,
`sendForSignature`'s approval UI must require an explicit "I have reviewed this
document" confirmation — not a generic "Approve" click — before it's allowed to fire.
Store `reviewed_by_user_id`/`reviewed_at` on the envelope when that happens.

## 7. Provider recommendation

**Recommended: Dropbox Sign (formerly HelloSign) API.**

| Criterion | Dropbox Sign | DocuSign | Documenso |
|---|---|---|---|
| Field placement on a freshly-generated doc | **Text-tag anchors** — embed `[sig\|buyer]` in the PDF, API auto-places fields. No manual template step. | Template-first mental model; dynamic per-document field placement is more work. | Supports API-driven placement; younger product, smaller ecosystem. |
| Auth complexity | Simple API key | JWT grant / RSA consent flow (heavier) | API key, self-hosted or hosted |
| Setup speed | Fast | Slower | Fast, but fewer production references |
| Market trust signal | Recognized | Strongest brand recognition | Least recognized |
| Cost model | Per-envelope, standard SaaS pricing | Higher, enterprise-oriented | Open-source — can self-host to cut per-envelope cost at scale |

Dropbox Sign wins v1 specifically because of the text-tag mechanism — it's the
best fit for documents that are generated fresh every time rather than uploaded once
and reused. DocuSign is worth revisiting if a customer specifically asks for it by
name (real trust-signal value); Documenso is worth revisiting if per-envelope vendor
cost becomes a concern at scale.

**Env vars:** `DROPBOX_SIGN_API_KEY`, `DROPBOX_SIGN_WEBHOOK_SECRET` (single
platform-level account for v1 — see open decision #3).

## 8. Webhook

New route: `POST /api/webhooks/contracts/dropbox-sign` — the **first** webhook
handler in this codebase (there's no existing one to copy; build it against Dropbox
Sign's documented callback event shape). Responsibilities, in order:

1. Verify the webhook signature against `DROPBOX_SIGN_WEBHOOK_SECRET`.
2. Insert the raw payload into `contract_envelope_events` (audit trail first, before
   any interpretation — so nothing is ever lost even if step 3+ throws).
3. Map event type → update `contract_envelopes.status` and the relevant
   `contract_signers.status` / `signed_at`.
4. On the "all parties signed" event: download the final signed PDF from the
   provider, store it through the existing Drive storage-sync pipeline
   (`src/lib/drive/storage-sync.ts`) into `signed_document_url`, post a work-log
   event, and post a system message into the originating room/topic (e.g. "✅
   Riverside Commons LOI — signed by both parties"). If `deal_id` is set, surface a
   suggested CRM deal-stage advance (behind its own approval — don't auto-move stages
   silently).

## 9. UI — how it should look

See the attached mockup artifact for the exact visual treatment. Three surfaces:

1. **Chat artifact card** — same visual family as the existing `tool_result` cards
   (`src/components/integrations/ToolResultInlineCard.tsx`): one status pill per
   signer (Sent / Viewed / Signed / Declined), a primary "View signing status" action,
   and a "Void" action while still pending.
2. **Drive** — the contract artifact shows a signature-status badge in place of the
   generic "saved" state; clicking opens the same signing-status view as the chat card.
3. **CRM Deal page** — a new "Contracts" section listing every envelope linked to that
   deal, its status, and a link to view/void it.

## 10. Success criteria

- End-to-end: "draft an LOI for Riverside Commons, $7.55M, buyer John Smith, seller
  ABC Holdings" → document generated with signer fields → human review confirmation →
  sent → both parties receive a real, working signing email → status updates live in
  the chat card as each party signs → fully-executed PDF lands in Drive automatically →
  CRM deal reflects the signed contract.
- `contract.checkStatus` always reflects real provider state — never a model-invented
  answer.
- Voiding an envelope actually cancels it at the provider, not just locally.

## 11. Suggested build phases

1. **Foundation** — data model, `contract.draftDocument` + LOI template with anchor
   tags, PDF rendering support for the new artifact type. No sending yet — validate
   document quality first.
2. **Send + track** — Dropbox Sign integration, `sendForSignature` / `checkStatus` /
   `voidEnvelope`, webhook handler, chat status card.
3. **Close the loop** — CRM deal page section, suggested deal-stage advance on full
   execution, Purchase & Sale Agreement template.

## 12. Open decisions (need your sign-off before build starts)

1. **Provider**: Dropbox Sign (recommended above) vs. DocuSign vs. Documenso —
   pricing and vendor relationship may matter more than the technical tradeoffs.
2. **Legal-review gate**: recommend requiring an explicit human-review confirmation
   (not just a generic approval click) plus an "AI-drafted — attorney review
   recommended" disclaimer on generated contracts before they can be sent. Confirm
   you want this as a hard requirement, not optional.
3. **Signing account model**: one platform-level Dropbox Sign account for all
   workspaces (simplest, matches how email works today) vs. per-workspace connected
   accounts (more scalable, real setup work, mirrors an already-open question about
   per-workspace AI provider credentials). Recommend starting with the platform-level
   account and revisiting if a customer needs their own branded signing account.
