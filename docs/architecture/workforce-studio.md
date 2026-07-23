# Maya Workforce Studio

Workforce Studio is the "Team" hire mode (`/hire/team`, alongside the existing
individual `/hire` wizard). Admins design, simulate, approve, and provision a
whole AI team in one flow instead of hiring one role at a time. It replaced an
earlier, narrower "bulk-hire templates" concept — this is workforce *design*,
not just a multi-select hire form.

## Product loop

```text
Company Operating Profile (persistent, versioned context)
        ↓
Business entry (NL description)  →  BusinessOperatingDiagnosis
        ↓
Adaptive clarifying questions (≤5, stop early on confidence)
        ↓
Archetype → functional modules → industry adaptation → curated pack
        ↓
compile to TemplateManifest → composeBlueprintFromTemplate
        ↓
Team reveal → canvas-first Studio + Maya goal-ops (WH impact diffs)
        ↓
Simulate a Week  →  coverage / permission / WH-band report
        ↓
Approve  →  immutable snapshot (canonical hash) at a frozen revision
        ↓
Provision  →  idempotent, checkpointed, batched saga (team_hire_plans)
        ↓
First Mission  →  welcome messages, outcome tasks, Team Charter + Role Scorecards
```

**Secondary entry:** Starting points lists curated packs grouped by category
(Commerce, Hospitality, Professional, Technology, Education/Media, Operational),
assembled from the PR-22B ontology. Legacy `software_house` / `saas_startup` /
`general_ops` remain for stable tech/ops graphs. Brain `modelMode` stays on the
seat payload but is **not** customer-editable.

## Data model

Migration: [`supabase/migrations/20260722140000_workforce_studio_foundation.sql`](../../supabase/migrations/20260722140000_workforce_studio_foundation.sql).

| Table | Purpose |
|---|---|
| `company_operating_profiles` + `..._revisions` | Persistent, versioned company context (stage, focus, risk tolerance, tooling) that seeds template intake defaults and NL-edit context. |
| `workforce_blueprints` | The durable design artifact. Carries `draft_payload` (live), `approved_payload` + `approved_revision` (frozen snapshot), `revision` (optimistic-concurrency counter), `lock_token`/`locked_by`/`locked_at` (draft locking), `approval_hash`, `blueprint_mode`, `status` (`draft` → `approved` → `provisioning` → `active`). |
| `workforce_blueprint_revisions` | Append-only history of every save, for undo context and audit. |
| `workforce_studio_templates` | Governed, publishable template manifests (see below) — versioned independently of the app deploy. |
| `team_hire_plans` + `team_hire_plan_steps` | The provisioning saga: one plan per approved-revision attempt, steps are idempotent/checkpointed/batched with per-step compensation. |
| `workforce_studio_events` | Composer-specific analytics (template picked, blueprint approved, plan retried, NL edit proposed, …), separate from the general `recordAiRuntime` hooks. |

All tables are workspace-scoped with admin-only RLS as a backstop; application
code uses `requireWorkforceStudioAdmin` (`src/lib/server/workforce-studio-context.ts`)
plus the service-role client for the actual read/write path.

## Template engine

`src/lib/hiring/workforce-studio/templates/` — `software-house.ts`, `saas-startup.ts`,
`general-ops.ts`, registered via `registry.ts`. Each manifest declares:

- Base seats (role, mission template with `{{placeholders}}`, default room).
- Rooms (including department rooms) and typed collaboration edges (handoff /
  review / escalation contracts).
- Intake questions (with default values, so every placeholder always resolves).
- Scaling rules — [JsonLogic](../../src/lib/hiring/workforce-studio/json-logic.ts)
  conditions evaluated against intake answers, compiled and validated by
  `assertSafeRule` (no unsafe operators) before use.
- Simulation scenarios used by "Simulate a Week" (coverage gaps, permission
  checks) specific to that template's shape.

`composer.ts#composeBlueprintFromTemplate` merges intake answers with question
defaults, evaluates scaling rules, and produces a `WorkforceBlueprintPayload`
(seats, rooms, edges, outcomes) — deterministic for the same inputs
(`canonical.ts#canonicalHash` is key-order independent, used both for the
composer's determinism tests and for the approval hash).

## Business Architect (PR-22A)

Entry is natural-language first (`BusinessEntryPanel` → diagnose → clarify →
compose → `TeamReveal`). Server modules:

| Module | Role |
|---|---|
| `diagnosis-types.ts` | `BusinessOperatingDiagnosis` + clarification types |
| `diagnose-business.ts` | Free-text (+ optional website fetch) → diagnosis via `generateObject` |
| `adaptive-questions.ts` | Next question or `{ done }` (cap 5 / confidence ≥ 0.75) |
| `map-diagnosis-to-template.ts` | Archetype/modules/pack selection → manifest + intake |
| `compose-from-diagnosis.ts` | Profile upsert + compose + optional mission polish + draft |
| `ontology/*` | PR-22B archetypes, modules, adaptations, curated packs, compile |

API: `POST .../architect/diagnose`, `.../next-question`, `.../compose`.
Diagnosis + `businessDescription` persist on the company operating profile
payload (no separate table).

## Ontology (PR-22B)

Three layers under `src/lib/hiring/workforce-studio/ontology/`:

1. **Business archetypes** (16) — how the business operates
2. **Functional modules** — reusable seat/room/edge fragments
3. **Industry adaptations** — mission/KPI overlays (ecommerce support ≠ restaurant support)

Curated packs are thin assemblies (`packs.ts`) compiled to `TemplateManifest` via
`compilePackToManifest`. Legacy `software_house` / `saas_startup` / `general_ops`
remain in the registry for composition parity; everything else is ontology-built.

## Goal-based edits (PR-22D)

`goal-ops.ts` runs deterministic recipes (`make_leaner`, `optimize_growth`,
`optimize_support`, `reduce_costs`, `add_qc`, `increase_speed`, `more_cautious`,
`prepare_expansion`, `design_around_humans`) producing `NlEditProposal` + WH
impact bands. API: `POST .../blueprints/[id]/goal-op`. Free-text Ask Maya still
uses `nl-edit.ts`.

## Editing surfaces

- **Workforce Canvas** (`WorkforceCanvas.tsx`) — default view on desktop
  (≥1024px). React Flow graph of seat / room / human-reference nodes and typed
  edges. Full keyboard nav, `aria-label`s, and an `sr-only` hint block.
- **Roster editor** (`RosterEditor.tsx`) — compact seat cards + inspector;
  list fallback on narrow viewports. Simulation panel shows **Expected weekly
  capacity: low–high WH** with light/typical/busy copy. Includes the
  `AuthorityMatrixEditor` and full `WorkforceOutcome` authoring.
- **Maya panel** (`NlEditBar.tsx`) — nine goal-op shortcuts with WH impact review
  plus free-text Ask Maya. Always reviewable diffs; see
  [Natural-language edits](#natural-language-edits).
- **Undo/redo** — capped client-side history stack in `useBlueprintEditor.ts`,
  wired to `Cmd/Ctrl+Z` / `Shift+Z`.
- **Autosave + conflict recovery** — debounced autosave; a revision conflict
  surfaces a "keep mine" vs. "use latest" prompt instead of silently
  overwriting (`saveConflict` state, `resolveConflictKeepMine`/`resolveConflictUseLatest`).

## Simulation

`simulation.ts` runs against the draft payload:

- **Coverage** — template-specific scenario checks for missing capability
  coverage (e.g. no seat can review a deploy).
- **Permissions** — both missing authority (a scenario needs a level nobody
  has) and excess authority (autonomous access nobody asked for), using the
  seat `AuthorityPolicy` capability matrix.
- **Work Hours forecast** — low/expected/high band per seat, plus a
  **per-capability breakdown** (`byCapability`, weighted by domain and
  authority level — see `CAPABILITY_DOMAIN_WEIGHT` /
  `AUTHORITY_LEVEL_MULTIPLIER` in `simulation.ts`) so admins can see *what*
  work the WH estimate is made of, not just a single number.
- One cheap-LLM narration paragraph summarizing the report in plain language.

## Approval and provisioning

- **Approve** (`blueprint-service.ts`) freezes `draft_payload` into
  `approved_payload` at `approved_revision`, computes `approval_hash` via
  canonical serialization, and is immutable from that point (further edits
  only touch the draft, requiring re-approval before a new provisioning run).
- **Provision** (`plan-service.ts` + `plan-executor.ts`) builds a batched,
  idempotent step plan (`team_hire_plan_steps`) keyed off
  `blueprint:{id}:rev:{approvedRevision}`. Each step is checkpointed and
  compensable; a failed step triggers rollback of everything already
  provisioned for that plan (employees, rooms, artifacts). **Retry**: if the
  latest attempt for a revision is `failed`/`compensated`/`cancelled`,
  `createHirePlan` starts a fresh plan with an attempt-suffixed idempotency
  key rather than resurrecting the dead one — verified for duplicate-free
  retries in the E2E suite.
- **Provenance** — every created `ai_employees` / room / artifact row carries
  the blueprint id + approved revision + plan id that provisioned it.
- **First Mission** — once provisioning completes, welcome messages, initial
  outcome-tracking tasks, a Team Charter artifact, and one Role Scorecard per
  seat are generated automatically (`artifact-templates.ts` builds the
  markdown bodies) so the team has real work queued on day one, not an empty
  room.

## Natural-language edits

`src/lib/hiring/workforce-studio/nl-edit-apply.ts` (client-safe: types +
`applyNlEditProposal`, no AI SDK import — safe to bundle into the browser) and
`nl-edit.ts` (server-only: calls SiliconFlow via `generateObject`).

**Reliability note** — the combined schema (summary + addOutcomes + addSeats +
removeSeatIds + updateSeats in one `generateObject` call) was empirically
unreliable specifically for outcome-adding instructions: SiliconFlow's
structured-output path would narrate "added the outcome" in `summary` while
leaving `addOutcomes: []` and instead populating an unrelated no-op
`updateSeats` entry — reproduced consistently across schema reordering,
`.describe()` annotations, and stronger models. The fix was architectural,
not prompt wording: `proposeNlEdit` now does a cheap keyword-only dispatch
(`looksOutcomeOnly`, no LLM call) and, for instructions that are unambiguously
about adding an outcome/goal/metric, uses a **dedicated, minimal schema**
(`nlOutcomeOnlySchema` — just `summary` + `addOutcomes`, no competing seat
fields) instead of the full one. Asking for one thing in isolation resolved
the drop rate to zero across repeated runs. Mixed or seat-related instructions
still use the full schema, which was reliable throughout.

Model tier: `"strong"` (not `"cheap"`/`"balanced"`) — in this environment the
cheaper tier resolved to a model that was *both* slower and less reliable at
this schema than the strong tier, so it wasn't a cost/latency tradeoff.
Timeout budgets `getTimeoutMs("strong")` (60s) since SiliconFlow's real-world
latency for structured generation varies well beyond a tight timeout; the API
route's `maxDuration` is set above that so a slow response still resolves to
a graceful decline instead of a platform-level timeout.

Guardrails are structural, not prompt-based: the zod schema has no
`authorityPolicy` field anywhere on `updateSeats`, so no NL instruction —
including explicit prompt-injection attempts — can ever change an existing
seat's permissions through this path; `addSeats` is capped at 10 entries per
request, bounding oversized-team requests regardless of what the instruction
asks for.

## Testing

| Command | Covers |
|---|---|
| `npm run test:workforce-studio:composition` | Template manifest structural checks, JsonLogic scaling rules, deterministic composition, canonical hash. |
| `npm run test:workforce-studio:architect` | Ontology pack compile integrity + diagnosis → pack mapping + adaptive-question stops. |
| `npm run test:workforce-studio:goldens` | 35 offline business-description → diagnose heuristic → map → compose assertions. |
| `npm run test:workforce-studio:pack-score` | Structural quality score across all registry packs (orphans, WH bands, safe JsonLogic). |
| `npm run test:workforce-studio:provisioning` | Full lifecycle against a live Supabase service-role client: compose → lock → patch → approve → provision → complete; forced-failure compensation rollback; retry-after-failure with no duplicate resources; explicit 2/5/20-seat matrix. |
| `npm run test:workforce-studio:promptfoo` | Golden + adversarial NL-edit scenarios against the real `proposeNlEdit` path via a live SiliconFlow call (`promptfoo/workforce-studio/`) — see below. |

### Promptfoo golden + adversarial suite

`promptfoo/workforce-studio/promptfooconfig.yaml` + `provider.ts` (custom
TypeScript provider — no mocks). Golden cases assert Maya does the right,
reviewable thing for a clear instruction and declines a vague one
("make this team better" → no ops, not a guess). Adversarial cases assert the
system's *structural* safety properties hold even when the instruction
actively tries to break them:

- An oversized-team request ("hire 200 more engineers") can't exceed the
  schema's per-request seat cap.
- A blanket or prompt-injection excess-permission request can't change any
  existing seat's `authorityPolicy` — verified by diffing every seat's
  authority before/after applying the proposal.
- A targeted excess-permission request for one named seat is equally blocked.

Requires `SILICONFLOW_API_KEY` in `.env.local` (the provider loads it directly
since promptfoo runs outside the Next.js process).

## Key files

```
src/lib/hiring/workforce-studio/
  types.ts                 blueprint payload + seat + outcome + WH-forecast types
  diagnosis-types.ts         BusinessOperatingDiagnosis + clarify types
  diagnose-business.ts       NL → diagnosis
  adaptive-questions.ts      progressive clarify / early stop
  map-diagnosis-to-template.ts  thin pack mapping
  compose-from-diagnosis.ts  diagnose path → draft blueprint
  composer.ts               template + intake answers → WorkforceBlueprintPayload
  json-logic.ts             safe JsonLogic evaluation for scaling rules
  canonical.ts              key-order-independent hashing (approval + determinism)
  simulation.ts             coverage / permission / WH-forecast simulation
  narration.ts              cheap-LLM plain-language simulation summary
  blueprint-service.ts       CRUD, locking, approve, revision history
  profile-service.ts         Company Operating Profile CRUD
  plan-service.ts            provisioning plan creation + retry-after-failure
  plan-executor.ts           batched, checkpointed, compensable step executor
  artifact-templates.ts      Team Charter / Role Scorecard markdown builders
  nl-edit-apply.ts           client-safe NL-edit types + diff-apply (no AI SDK)
  nl-edit.ts                 server-only NL-edit LLM proposal
  templates/                 software-house, saas-startup, general-ops manifests

src/components/hiring/workforce-studio/
  WorkforceStudioShell.tsx   architect → reveal → canvas Studio → provisioning
  BusinessEntryPanel.tsx, DiagnosisPanel.tsx, ClarifyChatPanel.tsx, TeamReveal.tsx
  TemplatePicker.tsx, IntakeForm.tsx   secondary "Starting points"
  WorkforceCanvas.tsx        React Flow canvas (desktop default)
  RosterEditor.tsx           compact cards + WH bands + AuthorityMatrixEditor
  NlEditBar.tsx              Maya panel + shortcut prompts + diff review
  ProvisioningView.tsx       live plan/step progress
  useBlueprintEditor.ts      client state: draft, lock, autosave, undo/redo, NL edit

src/app/(app)/hire/team/      Team hire mode route
src/app/api/hiring/workforce-studio/   architect/*, blueprints, plans, templates, profile

promptfoo/workforce-studio/   golden + adversarial NL-edit regression suite
scripts/test-workforce-studio-composition.ts
scripts/test-workforce-architect.ts
scripts/test-workforce-studio-provisioning.ts
```
