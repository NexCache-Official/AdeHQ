# V19.9.0c-final — Low-Risk Caller Migration Readiness

**Audit date:** 2026-07-04  
**Package:** `adehq@19.9.0`  
**Scope:** Verification only — no new caller migrations, no hot-path changes, no UI changes.

---

## Summary verdict

**READY for V19.9.0d planning — GO with documented gaps.**

All five low-risk migration groups follow the same pattern:

- **off** → legacy path only (default production behavior)
- **shadow** → legacy output + runtime observation (planned work units where context allows)
- **on** → runtime execution + fallback to legacy on failure

Terminal tests pass (**32/32** in `npm run test:ai-callers`). Every migrated group has **forced runtime failure → fallback** coverage. Off-mode rollback is confirmed via dispatch helpers and runtime foundation tests.

**Explicit recommendation:** Proceed to **V19.9.0d-1** (hot path readiness + shadow only). Do **not** enable `AI_RUNTIME_V2_MODE=on` on the employee reply hot path in the first d-slice.

---

## Per-caller audit table

| Caller | Module / route | Capability | workType | runtimeMode | Fallback reason | Forced fallback test |
|--------|----------------|------------|----------|-------------|-----------------|----------------------|
| Topic summary | `src/lib/topic-summary/generate.ts` | `summarization` | `topic_summary` | `balanced` | `topic_summary_runtime_failed` | ✅ |
| LLM classifier | `src/lib/orchestration/llm-classifier.ts` | `classification` | `orchestration_classify` | `efficient` | `orchestration_classify_runtime_failed` | ✅ |
| Hiring recruiter | `src/lib/hiring/recruiter-llm.ts` → `recruiter/route.ts` | `structured_chat` | `hiring_recruiter` | `efficient` | `hiring_recruiter_runtime_failed` | ✅ |
| Hiring candidates | `src/lib/hiring/candidates-llm.ts` → `candidates/route.ts` | `structured_chat` | `hiring_candidates` | `efficient` | `hiring_candidates_runtime_failed` | ✅ |
| File embeddings | `src/lib/server/file-embeddings.ts` | `embedding` | `file_embedding` / `query_embedding` | `embedding` | `file_embeddings_runtime_failed` | ✅ |

Shadow plan fallback reasons: `topic_summary_shadow_plan`, `orchestration_classify_shadow_plan`, `hiring_recruiter_shadow_plan`, `hiring_candidates_shadow_plan`, `file_embeddings_shadow_plan`.

---

## 1. Topic summary (`generate.ts`)

### Off (`AI_RUNTIME_V2_MODE=off`)
- `generateTopicSummaryPayloadOld()` — direct `generateObject` + `siliconFlowChatModel`
- No runtime call, no runtime work units
- **Test:** dispatch off, legacy path reached (skips live call if `SILICONFLOW_API_KEY` missing)

### Shadow
- Legacy path returns summary; async `planRoute` + optional planned work unit
- Shadow errors swallowed (`console.warn` only)
- **Test:** shadow dispatch + legacy path (SiliconFlow skip OK)

### On
- `runtime.generateObject()` with `reasoningProfile: "low"`
- Work unit create → start → complete when `client` + `workspaceId` (`refresh.ts` passes both)
- **Test:** mock on-mode schema-valid output

### Fallback
- Failed work unit + `recordAiRuntime` + `generateTopicSummaryPayloadOld()`
- **Test:** forced runtime failure via `setTopicSummaryTestHooks`

### Context / work units
| Field | Source |
|-------|--------|
| `workspaceId`, `roomId`, `topicId` | `refreshTopicSummary` → `generateTopicSummaryPayload` options |
| `client` | `refresh.ts` |
| `sourceMessageCount` | message list length |

**Gap:** None for production refresh path.

---

## 2. LLM classifier (`llm-classifier.ts`)

### Off
- `classifyWithLlmOld()` — unchanged SiliconFlow classifier; returns `null` if API key missing
- **Test:** off dispatch + legacy null without key

### Shadow
- Legacy result returned; shadow plan + planned work unit when `client` + `workspaceId`
- **Test:** shadow legacy stub path

### On
- `runtime.generateObject()` with `reasoningProfile: "none"`
- **Test:** mock schema-valid plan

### Fallback
- **Test:** forced failure → legacy stub + failed work unit

### Context / work units
| Field | Source |
|-------|--------|
| `workspaceId`, `roomId`, `topicId`, `messageId` | `OrchestratorInput` |
| `client` | `orchestrateConversation(input, { client })` from messages route (**c-2.1**) |
| `sourceMessageCount` | `recentMessages.length` |

**Gap:** None on room message orchestration path when confidence &lt; 0.75 triggers LLM.

---

## 3. Hiring recruiter (`recruiter-llm.ts` + route)

### Off
- `generateRecruiterResponseOld()` — legacy SiliconFlow `generateObject`
- Route skips LLM when off + no SiliconFlow key
- **Test:** off dispatch via shared rollback test

### Shadow
- Legacy response + shadow planned work unit when validated `workspaceId`
- **Test:** shadow work unit with `workspaceId` + mock client

### On
- Runtime `structured_chat` / `efficient` / `reasoningProfile: "none"`
- **Test:** mock schema-valid recruiter response

### Fallback
- **Test:** forced failure → legacy stub + failed work unit

### Context / work units
| Field | Source |
|-------|--------|
| `workspaceId` | Client payload + server `resolveHiringWorkspaceContext` (**c-3.1**) |
| `hiringSessionId` | Hire/Maya flows + session lookup (preferred over raw workspaceId) |
| `client`, `userId` | `requireAuthUser` in route |
| `topicId`, `mayaRoomId` | Maya hiring payload (server derivation fallback) |

**Gap:** Invalid cross-tenant `workspaceId` is rejected silently (by design — hiring continues without work units).

---

## 4. Hiring candidates (`candidates-llm.ts` + route)

### Off
- `generateCandidateCopiesOld()`; deterministic candidates if copies undefined
- **Test:** off dispatch via rollback test

### Shadow
- Legacy copies path + planned work unit when validated `workspaceId`
- **Test:** shadow planned work unit (**c-final**)

### On
- Runtime path; deterministic merge unchanged
- **Test:** mock copies + without-workspaceId success (**c-final**)

### Fallback
- **Test:** forced failure → legacy stub + failed work unit

### Context / work units
Same resolution as recruiter via `resolveHiringWorkspaceContext`.

**Gap:** Same as recruiter — work units require validated workspace context.

---

## 5. File embeddings (`file-embeddings.ts`)

### Off
- `embedTextsOld()` — raw `POST /embeddings` (unchanged model, batch size 16, dim 1024)
- **Test:** embed dispatch off + rollback test

### Shadow
- Legacy embed executes; shadow plan + planned work unit when `client` + `workspaceId`
- **Test:** shadow planned work unit (SiliconFlow skip OK) (**c-final**)

### On
- `runtime.embed()` via SiliconFlow or mock adapter
- **Test:** stable mock dimensions + query embed

### Fallback
- **Test:** forced failure → failed work unit + legacy path attempt

### Context / work units
| Field | Source |
|-------|--------|
| `workspaceId`, `client` | `embedFileChunks(client, workspaceId, …)` from upload routes |
| `roomId`, `topicId` | `files/upload`, `drive/upload` options |
| `fileId` | chunk embedding batches |
| Query embed | `file-context.ts` passes `workspaceId`, `topicId` (no client — no work unit on query-only path) |

**Gaps:**
- Query embedding (`embedQueryText`) does not pass `client` — **no work unit** on RAG query path (acceptable; file batch path persists work units).
- Shadow/on still need SiliconFlow for **actual vectors** in shadow mode (runtime only observes).

---

## Fallback test matrix

| Caller | Test name in `test-ai-callers.ts` |
|--------|-----------------------------------|
| Topic summary | `on mode forced runtime failure falls back to legacy path` |
| Classifier | `classifier on mode forced runtime failure falls back cleanly` |
| Recruiter | `recruiter on mode forced runtime failure falls back cleanly` |
| Candidates | `candidates on mode forced runtime failure falls back cleanly` |
| Embeddings | `embedTexts forced runtime failure falls back cleanly` |

---

## Off-mode rollback confirmation

Default env: `AI_RUNTIME_V2_MODE=off` (see `src/lib/ai/runtime/flags.ts`).

| Check | Status |
|-------|--------|
| All dispatch helpers return `"old"` when mode=off | ✅ `off mode rollback — all low-risk dispatch helpers return old` |
| `runtime.generateText` throws when mode=off | ✅ `test:runtime:mock` |
| Production callers use dispatch wrappers | ✅ |
| Hot path **not** migrated | ✅ `process-employee-response.ts`, `model-router.ts`, `process-queued-run.ts` unchanged |

---

## Work unit persistence summary

| Caller | Persists when | Does not persist when |
|--------|---------------|------------------------|
| Topic summary | `refresh.ts` provides `client` + `workspaceId` | — |
| Classifier | Messages route → `orchestrateConversation({ client })` + input workspace | Deterministic confidence ≥ 0.75 (LLM not called) |
| Hiring | Validated `workspaceId` from client/session/topic/room | Invalid/missing workspace context |
| Embeddings (batch) | Upload routes pass `client` + `workspaceId` | Query-only embed path |
| Embeddings (query) | — | No `client` passed intentionally |

---

## Tests run (c-final audit)

| Command | Result |
|---------|--------|
| `npm run audit:ai-callers` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS |
| `npm run test:runtime:mock` | 7/7 PASS |
| `npm run test:work-hours` | PASS (placeholder) |
| `npm run test:ai-callers` | **32/32 PASS** |
| `npm run test:runtime:db` | SKIPPED — `NEXT_PUBLIC_SUPABASE_URL not configured` |

---

## Remaining risks (documented, not blockers)

1. **Live SiliconFlow E2E** — off/shadow legacy paths skip in CI when API key absent; mock covers on-mode logic.
2. **DB work unit E2E** — `test:runtime:db` skips without Supabase env; mock client tests cover insert/update chains.
3. **Shadow mode vectors** — embeddings/classifier/hiring still call legacy SiliconFlow for real output in shadow.
4. **Hiring workspace validation** — silent skip on invalid workspaceId is intentional (no user-facing failure).
5. **No production flag flip** — all slices safe because default remains `off`.

---

## Hot path exclusion verified

These files were **not** modified for Runtime V2 caller migration:

- `src/lib/server/process-employee-response.ts`
- `src/lib/ai/model-router.ts`
- `src/lib/server/process-queued-run.ts`

Employee replies still flow: `processEmployeeResponse` → `routeEmployeeResponse` → `callSiliconFlowEmployee`.

---

## Go / no-go for V19.9.0d

### Go criteria (user rule)

| Criterion | Status |
|-----------|--------|
| `test:ai-callers` passes | ✅ 32/32 |
| Every migrated caller has forced fallback coverage | ✅ |
| Off mode rollback confirmed | ✅ |
| No hidden UI/runtime regressions | ✅ (no UI changes in c-slices; default off) |
| Work unit gaps documented | ✅ (this doc) |

### Verdict: **GO** for V19.9.0d-1

Recommended next slices (do not combine):

1. **V19.9.0d-1** — Hot path readiness + shadow only (instrumentation, no on-mode user impact)
2. **V19.9.0d-2** — Direct employee respond path (`process-employee-response.ts`)
3. **V19.9.0d-3** — Queued orchestration (`process-queued-run.ts`)
4. **V19.9.0d-4** — `model-router.ts` cleanup / thin wrapper

Do **not** set `AI_RUNTIME_V2_MODE=on` on the employee hot path until d-2+ is tested with the same fallback matrix as this audit.

---

## Related docs

- [`docs/ai-runtime-migration-checklist.md`](./ai-runtime-migration-checklist.md) — full migration inventory
- [`scripts/test-ai-callers.ts`](../scripts/test-ai-callers.ts) — terminal smoke + audit tests
