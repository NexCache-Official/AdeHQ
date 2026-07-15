# AI Runtime V2 — Preflight Audit (V19.8.2)

**Date:** 2026-07-04  
**Repo version:** 19.8.1 → 19.8.2 (audit only)  
**Scope:** Inventory only. **Zero runtime behavior changes** in this release.

This document is the migration checklist for Phase 5A (V19.9.0a–0e). It was produced by grepping the codebase and tracing call chains. Paths were verified on disk — do not trust stale plan references without confirming.

---

## Feature flags (planned for V19.9.0a — not implemented yet)

```env
AI_RUNTIME_V2_MODE=off            # off | shadow | on
AI_RUNTIME_V2_PROVIDER_PREF=auto  # auto | siliconflow | vercel | mock
```

| Mode | Behavior |
|------|----------|
| `off` | Current SiliconFlow / model-router path only |
| `shadow` | Old path executes; runtime V2 estimates route/cost/work minutes and logs only |
| `on` | Runtime V2 executes calls |

Legacy env names (`AI_RUNTIME_V2_ENABLED`, `AI_RUNTIME_V2_SHADOW_MODE`) must **not** be used in new code — normalize to `AI_RUNTIME_V2_MODE`.

---

## 1. Full list of AI / LLM callers

### Tier A — Direct LLM network calls (must migrate to runtime)

| # | File | Function / route | Capability (planned) | Usage logged? | Migration slice |
|---|------|------------------|----------------------|---------------|-----------------|
| A1 | `src/lib/topic-summary/generate.ts` | `generateTopicSummaryPayload()` | `summarization` | **No** | **V19.9.0c first** |
| A2 | `src/lib/orchestration/llm-classifier.ts` | `classifyWithLlm()` | `classification` | **No** | V19.9.0c |
| A3 | `src/app/api/hiring/recruiter/route.ts` | POST handler | `structured_chat` | **No** | V19.9.0c |
| A4 | `src/app/api/hiring/candidates/route.ts` | POST handler | `structured_chat` | **No** | V19.9.0c |
| A5 | `src/lib/server/file-embeddings.ts` | `embedTexts()`, `embedQueryText()`, `embedFileChunks()` | `embedding` | **No** | V19.9.0c |
| A6 | `src/lib/ai/siliconflow-call.ts` | `callSiliconFlowEmployee()` | `structured_chat` | Via parent | Wrap in SiliconFlowAdapter (0a); migrate via router (0d) |
| A7 | `src/lib/ai/structured-llm-call.ts` | `callStructuredLlm()` | (generic) | Via parent | Internal to adapter |
| A8 | `src/lib/ai/provider-health-call.ts` | `callProviderHealthCheck()` | `quick_reply` | Via test route | V19.9.0c (with test-provider) |

### Tier B — Employee hot path (mission-critical — migrate last)

| # | File | Entry | Calls | Usage logged? | Migration slice |
|---|------|-------|-------|---------------|-----------------|
| B1 | `src/lib/server/process-employee-response.ts` | `processEmployeeResponse()` | `beginAiRun` → `routeEmployeeResponse` | **Yes** | **V19.9.0d** |
| B2 | `src/lib/ai/model-router.ts` | `routeEmployeeResponse()` | mock engine OR `callSiliconFlowEmployee` | Partial (`recordAiRuntime`) | V19.9.0d |
| B3 | `src/lib/server/process-queued-run.ts` | queued orchestration | `routeEmployeeResponse` + `finalizeAiRun` | **Yes** | V19.9.0d |
| B4 | `src/app/api/employees/[employeeId]/respond/route.ts` | POST | `processEmployeeResponse` | **Yes** | V19.9.0d (via B1) |
| B5 | `src/app/api/agent-runs/[runId]/process/route.ts` | POST | `processQueuedRun` | **Yes** | V19.9.0d (via B3) |

### Tier C — Indirect / orchestration triggers (no direct LLM)

| File | Role |
|------|------|
| `src/lib/orchestration/conversation-orchestrator.ts` | Calls `maybeEnhanceWithLlm` → `classifyWithLlm` (A2) |
| `src/lib/server/queue-agent-runs.ts` | Creates `agent_runs` + reserves usage; no LLM |
| `src/lib/topic-summary/refresh.ts` | Calls `generateTopicSummaryPayload` (A1) |
| `src/app/api/topics/[topicId]/summary/refresh/route.ts` | Triggers refresh |
| `src/app/api/topics/[topicId]/summary/refresh/route.ts` | Triggers refresh |

### Tier D — Mock / deterministic (no runtime migration for LLM)

| File | Role |
|------|------|
| `src/lib/ai/employee-engine.ts` | `sendMessageToEmployee()` — scripted mock responses |
| `src/lib/ai/use-responder.ts` | Client → `/api/employees/.../respond`; falls back to mock engine |
| `src/lib/memory/curator.ts` | `curateMemoryDraft()` — **deterministic**, no LLM |
| `src/lib/artifacts/intelligence.ts` | Artifact parsing/detection — **deterministic**, no LLM |

### Tier E — Admin / diagnostics

| File | Role |
|------|------|
| `src/app/api/ai/test-provider/route.ts` | Health check via `callProviderHealthCheck` + `recordAiRuntime` |
| `src/app/api/ai/runtime/route.ts` | Returns in-memory `getAiRuntimeSnapshot()` — no LLM |

### Tier F — Embedding consumers (call Tier A5)

| File | Calls |
|------|-------|
| `src/lib/server/file-context.ts` | `embedQueryText()` for RAG retrieval |
| `src/app/api/files/upload/route.ts` | `embedFileChunks()` after upload |
| `src/app/api/drive/upload/route.ts` | `embedFileChunks()` after upload |

---

## 2. Full list of direct SiliconFlow calls

### SiliconFlow client shim

| File | Symbol | Notes |
|------|--------|-------|
| `src/lib/ai/siliconflow-client.ts` | `getSiliconFlowClient()`, `siliconFlowChatModel()`, `siliconFlowProviderOptions()` | **Single OpenAI-compatible entry** — target for SiliconFlowAdapter |

### Importers of `siliconflow-client`

| File | Usage |
|------|-------|
| `src/lib/ai/siliconflow-call.ts` | Employee structured calls |
| `src/lib/orchestration/llm-classifier.ts` | `generateObject` + DEFAULT_SILICONFLOW_MODEL |
| `src/lib/topic-summary/generate.ts` | `generateObject` + resolved balanced model |
| `src/app/api/hiring/recruiter/route.ts` | `generateObject` + cheap model |
| `src/app/api/hiring/candidates/route.ts` | `generateObject` + cheap model |
| `src/lib/ai/provider-health-call.ts` | `generateText` + provider options |
| `src/app/api/ai/test-provider/route.ts` | Injects `siliconFlowChatModel` into health check |

### Raw SiliconFlow HTTP (embeddings — bypasses AI SDK)

| File | Endpoint |
|------|----------|
| `src/lib/server/file-embeddings.ts` | `POST ${SILICONFLOW_API_BASE_URL}/embeddings` |

### SiliconFlow config / env

| File | Role |
|------|------|
| `src/lib/config/features.ts` | `SILICONFLOW_*` models, `isSiliconFlowConfigured()` |
| `src/lib/ai/model-catalog.ts` | `resolveModel()`, `estimateCost()` — env-based model IDs |
| `.env.example` | `SILICONFLOW_API_KEY`, `ADEHQ_SILICONFLOW_*`, `ADEHQ_EMBEDDING_MODEL` |

### Error / UI references (not calls)

| File | Role |
|------|------|
| `src/lib/ai/provider-errors.ts` | Human-readable SiliconFlow errors |
| `src/lib/ai/model-router.ts` | Checks `isSiliconFlowConfigured()` |
| `src/app/(app)/settings/page.tsx` | Documents `SILICONFLOW_API_KEY` |
| `src/app/api/agent-runs/[runId]/process/route.ts` | Hint text for missing key |

---

## 3. Full list of usage event writers

### Primary write path (`ai_usage_events` table)

| File | Functions | When |
|------|-----------|------|
| `src/lib/supabase/ai-runtime.ts` | `reserveUsage()`, `finalizeUsage()`, `sumTodayUsage()` | Core DB layer |
| `src/lib/ai/cost-guard.ts` | `beginAiRun()` → reserve; `finalizeAiRun()` / `blockAiRun()` → finalize | Employee respond + queued runs |
| `src/lib/server/queue-agent-runs.ts` | `createAgentRun()` + `reserveUsage()` | Orchestrated multi-employee runs |
| `src/lib/server/process-queued-run.ts` | `finalizeUsage()` (direct in some paths), `finalizeAiRun()` | Run completion |

### Delete path

| File | Role |
|------|------|
| `src/lib/server/topic-helpers.ts` | Deletes `ai_usage_events` when topic deleted |

### In-memory only (NOT persisted to `ai_usage_events`)

| File | Function | Notes |
|------|----------|-------|
| `src/lib/ai/runtime-log.ts` | `recordAiRuntime()` | Ring buffer + console |
| `src/lib/ai/model-router.ts` | calls `recordAiRuntime` | Employee path metrics |
| `src/lib/ai/cost-guard.ts` | calls `recordAiRuntime` | Run lifecycle |
| `src/app/api/ai/test-provider/route.ts` | calls `recordAiRuntime` | Health check |

### Callers with NO usage event today (gap for Runtime V2)

- `topic-summary/generate.ts`
- `llm-classifier.ts`
- `hiring/recruiter/route.ts`
- `hiring/candidates/route.ts`
- `file-embeddings.ts`
- `provider-health-call.ts` (except via test route logging)

---

## 4. Token / cost calculation paths

| File | Function | Used by |
|------|----------|---------|
| `src/lib/ai/model-catalog.ts` | `estimateCost()`, `estimateCostForRun()`, `resolveModel()`, `getOutputTokenCap()`, `getTimeoutMs()` | Router, cost-guard, hiring, settings |
| `src/lib/supabase/ai-runtime.ts` | `buildRunEstimate()` | `beginAiRun`, `queue-agent-runs` |
| `src/lib/ai/cost-guard.ts` | Pre-run limits vs `workspace_ai_settings.dailyTokenLimit`, `dailyCostLimitUsd`, `employeeDailyTokenLimit` | Employee respond |
| `src/lib/ai/model-router.ts` | Post-call `estimateCost()` for metrics | Employee respond |
| `src/lib/ai/provider-health-call.ts` | `healthCheckCost()` → `estimateCost()` | Test provider |
| `src/lib/ai/runtime-log.ts` | Stores estimated cost in memory | Admin snapshot |

**Work minutes:** not implemented. Planned V19.9.1a shadow metering.

---

## 5. UI surfaces showing model / provider / modelMode / resolvedModelId

### User-facing (should change in V19.9.2)

| File | What is shown |
|------|---------------|
| `src/components/hiring/HireScreens.tsx` | `intelligenceLabel(modelMode)`, `RUNTIME_MODE_LABELS`, **`displayEngineModel(resolvedModelId)`** in advanced panel |
| `src/components/HireEmployeeModal.tsx` | Provider picker, `modelMode` picker, preview line with provider + modelMode |
| `src/app/(app)/workforce/[employeeId]/page.tsx` | Intelligence chip, edit modal: provider, **model**, modelMode |
| `src/components/EmployeeCard.tsx` | `{employee.provider} · {employee.model}` |
| `src/components/RoomChat.tsx` | DM header: `{dmEmployee.provider} · {dmEmployee.model}`; metrics in respond payload |
| `src/app/(app)/settings/page.tsx` | Provider list (SiliconFlow + "coming soon"), token/cost limits |

### Admin / debug (keep with richer detail)

| File | What is shown |
|------|---------------|
| `src/components/AiRuntimePanel.tsx` | SiliconFlow configured, default model, last run provider/model/modelMode, recent log entries |
| `src/app/api/ai/test-provider/route.ts` | Returns provider, model, modelMode in JSON |

### Internal / types only

| File | Role |
|------|------|
| `src/lib/hiring/intelligence-labels.ts` | `displayEngineModel()`, `intelligenceLabel()` |
| `src/lib/hiring/candidate-engine.ts` | Sets `resolvedModelId`, `modelMode` on candidates |
| `src/lib/hiring/types.ts` | `AiEmployeeApplicant.resolvedModelId` |
| `src/lib/demo/demo-data.ts` | Demo employees with provider/model/modelMode |

---

## 6. Employee / hiring model assignment paths

### Database schema

| Location | Columns |
|----------|---------|
| `supabase/schema.sql` → `ai_employees` | `provider`, `model`, `model_mode` |
| `supabase/migrations/20250629120000_ai_runtime_and_work_graph.sql` | Backfill `provider`/`model_mode` by role |
| `supabase/migrations/20250702120000_maya_system_employee_v191.sql` | Maya seed: `siliconflow`, `deepseek-ai/DeepSeek-V4-Flash`, `balanced` |

### Server read/write

| File | Role |
|------|------|
| `src/lib/supabase/persistence.ts` | `employeeFromRow` / `employeeRow` — maps `model_mode` ↔ `modelMode`, `normalizeLiveProvider()` |
| `src/lib/server/ensure-maya.ts` | Ensures Maya row with default model |
| `src/lib/maya-employee.ts` | Static Maya defaults |
| `src/lib/server/room-messages.ts` | Reads employee provider/model/modelMode for message metadata |

### Hiring flow

| File | Role |
|------|------|
| `src/lib/hiring/candidate-engine.ts` | `tierModelMode()` → `resolveModel("siliconflow", mode)` → `resolvedModelId` |
| `src/lib/hiring/map-candidate.ts` | `candidateToEmployee()` writes `provider: "siliconflow"`, `model`, `modelMode` |
| `src/app/api/hiring/candidates/route.ts` | LLM generates candidate copy (cheap model) |
| `src/app/api/hiring/recruiter/route.ts` | Maya recruiter LLM (cheap model) |
| `src/components/HireEmployeeModal.tsx` | Manual hire with provider/modelMode |
| `src/components/hiring/HireScreens.tsx` | Displays tier + engine details |

### Workforce edit

| File | Role |
|------|------|
| `src/app/(app)/workforce/[employeeId]/page.tsx` | Edit provider, model, modelMode; save to DB |

### Per-run resolution (not stored on employee)

| File | Role |
|------|------|
| `src/lib/ai/resolve-run-model-mode.ts` | Message-aware mode override |
| `src/lib/server/process-employee-response.ts` | Uses stored `employee.modelMode` (does **not** call `resolveRunModelMode` today) |
| `src/lib/server/process-queued-run.ts` | **Does** call `resolveRunModelMode` |

### Unused schema (future BYOK)

| Table | Status |
|-------|--------|
| `model_provider_configs` | Defined in schema; **no application reads/writes** |

---

## 7. Agent run lifecycle touchpoints

| File | Role |
|------|------|
| `src/lib/supabase/ai-runtime.ts` | `createAgentRun`, `claimAgentRun`, `completeAgentRun`, `appendRunStep` |
| `src/lib/ai/cost-guard.ts` | `beginAiRun`, `finalizeAiRun` |
| `src/lib/server/queue-agent-runs.ts` | Queue orchestrated runs |
| `src/lib/server/process-queued-run.ts` | Process queued run |
| `src/app/api/agent-runs/[runId]/process/route.ts` | HTTP trigger |
| `src/app/api/rooms/[roomId]/topics/[topicId]/agent-runs/route.ts` | List runs |

---

## 8. Ordered migration checklist (V19.9.0a → 0d)

### V19.9.0a — Runtime types + flags + SiliconFlowAdapter

- [ ] Add `src/lib/ai/runtime/` module tree
- [ ] Implement `AI_RUNTIME_V2_MODE` + `AI_RUNTIME_V2_PROVIDER_PREF` in `runtime/flags.ts`
- [ ] Implement `SiliconFlowAdapter` wrapping `siliconflow-client` + `structured-llm-call` + unified fallbacks
- [ ] Implement `MockAdapter`
- [ ] Static `catalog/seed.ts` (manual model set)
- [ ] **No caller migration**
- [ ] Add terminal test scaffold (`test:runtime:mock`) — optional in 0a

### V19.9.0b — Additive DB + work unit skeleton

- [ ] Migration: `ai_model_catalog`, `ai_work_units`, extend `ai_usage_events`, extend `ai_employees`
- [ ] Seed catalog from `seed.ts`
- [ ] Work unit CRUD in `ai-runtime.ts`
- [ ] **No caller migration**

### V19.9.0c — Low-risk callers (shadow → on)

Order strictly:

1. [ ] `src/lib/topic-summary/generate.ts` — **first proof**
2. [ ] `src/lib/orchestration/llm-classifier.ts`
3. [ ] `src/app/api/hiring/recruiter/route.ts`
4. [ ] `src/app/api/hiring/candidates/route.ts` — **confirmed path:** `src/app/api/hiring/candidates/route.ts`
5. [ ] `src/lib/server/file-embeddings.ts` + consumers unchanged except embed path
6. [ ] `src/app/api/ai/test-provider/route.ts` + `provider-health-call.ts`

Each step: shadow mode first → terminal tests → enable `AI_RUNTIME_V2_MODE=on` per caller.

### V19.9.0c-final — Low-risk readiness audit (verification only)

- [x] All five low-risk groups migrated with off/shadow/on + fallback pattern
- [x] `npm run test:ai-callers` — 32/32 PASS (includes forced fallback + off rollback)
- [x] Readiness report: [`ai-runtime-low-risk-readiness.md`](./ai-runtime-low-risk-readiness.md)
- **Verdict:** GO for V19.9.0d-1 (hot path shadow instrumentation only — do not enable `on` on employee replies yet)

### V19.9.0d — Employee hot path (last)

#### V19.9.0d-1 — Hot path readiness + shadow instrumentation (in progress)

- [x] `src/lib/ai/runtime/hot-path-shadow.ts` — shadow planning helpers
- [x] `process-employee-response.ts` — direct path shadow only
- [x] `process-queued-run.ts` — queued path shadow only
- [x] `npm run test:employee-hot-path:shadow` — 7/7 PASS
- **Not in d-1:** runtime execution on hot path, model-router refactor, `on` mode employee replies

#### V19.9.0d-2 — Direct employee respond runtime execution (gated)

- [x] `AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION=false` (default) — hot-path execution gate
- [x] `src/lib/ai/runtime/employee-direct-runtime.ts` — runtime execution + fallback
- [x] `process-employee-response.ts` — uses `dispatchEmployeeDirectResponse`
- [x] `npm run test:employee-direct-runtime` — 6/6 PASS
- **Requires:** `AI_RUNTIME_V2_MODE=on` **AND** `AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION=true`
- **Not in d-2:** queued path, model-router cleanup

#### V19.9.0d-3 — Queued orchestration runtime execution (gated)

- [x] `AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION=false` (default) — queued execution gate
- [x] `src/lib/ai/runtime/employee-queued-runtime.ts` — runtime execution + fallback
- [x] `process-queued-run.ts` — uses `dispatchEmployeeQueuedResponse`
- [x] `npm run test:employee-queued-runtime` — 7/7 PASS
- **Requires:** `AI_RUNTIME_V2_MODE=on` **AND** `AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION=true`
- **Not in d-3:** model-router cleanup, direct production flag flips

#### V19.9.0d-4 — Model router cleanup + compatibility lock

- [x] `src/lib/ai/employee-response-contract.ts` — shared prompt/response helpers
- [x] `model-router.ts` — legacy route uses shared contract (behavior unchanged)
- [x] Direct/queued runtime helpers deduplicated via contract
- [x] `npm run test:model-router:compat` — 8/8 PASS
- **No behavior change:** execution flags default false; `callSiliconFlowEmployee` retained

#### V19.9.0e — Vercel Gateway adapter (not started)

1. [ ] Wire `resolveRunModelMode` into `process-employee-response.ts`
2. [ ] Refactor `model-router.ts` → runtime wrapper
3. [ ] Migrate `process-employee-response.ts` (shadow first)
4. [ ] Migrate `process-queued-run.ts`
5. [ ] Verify rollback: `AI_RUNTIME_V2_MODE=off` restores old path

### V19.9.0e — VercelGatewayAdapter

- [ ] Add `@ai-sdk/gateway`
- [ ] Implement adapter + fallback chain
- [ ] Optional `catalog/sync-vercel.ts` (non-blocking)

---

## 9. Gaps vs target architecture

| Gap | Priority |
|-----|----------|
| No provider abstraction layer | V19.9.0a |
| 6 LLM callers bypass usage ledger | V19.9.0c+ |
| Direct respond ignores `resolveRunModelMode` | V19.9.0d |
| Two fallback chains (`GLOBAL_FALLBACKS` vs `siliconFlowModelsForMode`) | Unify in SiliconFlowAdapter |
| `model_provider_configs` unused | Defer (BYOK) |
| No Vercel Gateway | V19.9.0e |
| No work minutes / weekly balances | V19.9.1a+ |
| Hiring UI shows raw model ID | V19.9.2 |

---

## 10. Rollback requirements (for migration phases)

- Old SiliconFlow path remains until V19.9.x proven
- `AI_RUNTIME_V2_MODE=off` disables runtime instantly
- All DB changes additive only
- Do not drop `ai_employees.provider` / `model` / `model_mode`
- Gateway failure → SiliconFlow direct
- Runtime failure → old `model-router` / `callSiliconFlowEmployee`

---

## 11. Regenerate this audit

```bash
npm run audit:ai-callers
# or: node scripts/audit-ai-callers.mjs
```

---

## 12. V19.8.2 verification

This release added only:

- `docs/audits/archive/ai-runtime-migration-checklist.md`
- `scripts/audit-ai-callers.mjs`

**No runtime, UI, or API behavior changes.**

## V19.9.0b — Runtime DB foundation (additive)

Migration: `supabase/migrations/20260705120000_ai_runtime_v2_foundation.sql`

- `ai_model_catalog` + static seeds
- `ai_work_units` + helper CRUD in `src/lib/supabase/ai-work-units.ts`
- Extended `ai_usage_events` nullable runtime columns
- Extended `ai_employees.intelligence_policy` / `routing_policy_id`

Still **no caller migration**. Runtime default remains `AI_RUNTIME_V2_MODE=off`.

```bash
npm run audit:ai-callers
npx tsc --noEmit
npm run build
npm run test:runtime:mock
npm run test:work-hours
npm run test:runtime:db   # SKIPs if SUPABASE_SECRET_KEY missing
```
