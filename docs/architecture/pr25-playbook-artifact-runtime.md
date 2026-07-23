# PR-25 — Playbook & Artifact Runtime

> Status: **architecture lock (pre-implementation)**  
> Audit / table reuse: [`pr25-playbook-artifact-audit.md`](./pr25-playbook-artifact-audit.md)  
> Brain spine: [`adehq-brain.md`](./adehq-brain.md)  
> Flags default **OFF**. Roles: **`admin` | `member` only**.

This document describes the runtime contracts for AdeHQ playbooks, registered procedures, structured artifacts, Steward collaboration levels, quality review, and the API surface. It assumes the audit’s extend-vs-add table map and does not invent parallel Brain, file, or ledger concepts.

---

## 1. Domain contracts overview

### 1.1 Core objects

| Domain object | Persistence | Meaning |
|---------------|-------------|---------|
| Playbook | `playbooks` + `playbook_versions` | Versioned, role-keyed DAG of work |
| Playbook run | `playbook_runs` + `playbook_run_steps` | One invocation; wraps one `brain_runs` row |
| Procedure | `procedure_registry` + `procedure_versions` | Governed, non-arbitrary executable unit |
| Procedure execution | `procedure_executions` | One invocation of a procedure version |
| Artifact | `artifacts` (+ additive `kind`, `current_version_id`, `work_item_id`) | Logical deliverable |
| Artifact version | `artifact_versions` (+ canonical/schema/provenance columns) | Immutable structured snapshot |
| Export | `artifact_exports` | Materialized bytes in `adehq-artifacts` |
| Provenance | `artifact_provenance` | Source → finding → section → version lineage |
| Review | `artifact_reviews` | Accept / request-changes / reject against a version |
| Brand kit | `workspace_brand_kits` + `workspace_brand_kit_versions` | Tokens/assets applied at render |

### 1.2 Contracts (logical shapes)

```ts
// Role-keyed — never employeeId in versioned definition
type PlaybookStepDef = {
  stepKey: string;
  roleKey: string;                 // e.g. "researcher" | "writer" | "reviewer"
  objective: string;
  capability: string;              // maps onto brain_capability_steps.capability
  dependsOn: string[];             // stepKey refs
  procedureKey?: string;           // optional registered procedure
  artifactIntent?: {
    schemaKey: string;
    schemaVersion: string;
    kind: string;
    sectionKeys?: string[];
  };
  estimatedWh: number;
  approvalRequired?: boolean;
  shareScope: "private" | "room" | "workspace";
};

type PlaybookVersionDef = {
  playbookId: string;
  version: number;
  steps: PlaybookStepDef[];
  hardWhLimit: number;
  collaborationMaxLevel: 0 | 1 | 2 | 3;
};

// Models emit this — never OOXML
type CanonicalArtifactContent = {
  schemaKey: string;
  schemaVersion: string;
  title: string;
  sections: Array<{
    key: string;
    title: string;
    blocks: unknown[];             // schema-validated
  }>;
  metadata?: Record<string, unknown>;
};

type ProcedureBackpack = {
  procedureKey: string;
  procedureVersionId: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  engine: "node_builtin" | "artifact_engine" | "worker_libreoffice" | "http_governed";
  permissions: string[];           // explicit capability grants
  timeoutMs: number;
  network: "none" | "allowlist";
};
```

### 1.3 Invariants

1. Canonical structured content is written **before** file generation.
2. Playbook versions reference **roles**, not employee IDs.
3. No arbitrary AI code execution in V1 — only `procedure_registry` entries.
4. `playbook_run` ↔ exactly one `brain_run`; steps link `brain_capability_steps`.
5. Private DM privacy inherits from `src/lib/workspace/access/` + `room-access.ts` (no admin bypass).
6. Customer meter is Work Hours via `recordBrainUsage`.
7. All new surfaces stay behind flags that default OFF.

---

## 2. Execution flow

```mermaid
flowchart TD
  trigger[Chat_or_API_trigger] --> access[AccessCheck_room_DM]
  access --> flag{Playbook_flag_ON?}
  flag -->|no| legacy[Existing_Brain_Steward_path]
  flag -->|yes| select[Resolve_playbook_version]
  select --> bind[Bind_roles_to_employees]
  bind --> wrap[Create_playbook_run_plus_brain_run]
  wrap --> steps[Materialize_playbook_run_steps]
  steps --> caps[Insert_brain_capability_steps]
  caps --> level{Collaboration_level}
  level --> steward[Steward_leases_findings_DAG]
  steward --> proc{Procedure_on_step?}
  proc -->|yes| backpack[Procedure_backpack_execute]
  proc -->|no| model[Capability_route_via_Brain]
  backpack --> meter[recordBrainUsage]
  model --> meter
  meter --> canon[Write_canonical_content_version]
  canon --> quality[Quality_engine]
  quality -->|pass_or_approve| render[Artifact_engine_export]
  quality -->|changes_requested| steward
  render --> store[adehq-artifacts_storage]
  store --> graph[insertWorkGraphEdge]
  graph --> receipt[WH_receipt_plus_run_complete]
```

### 2.1 Start sequence (detailed)

1. **Authorize** actor against room/topic (`src/lib/workspace/access/decisions.ts`, `src/lib/server/room-access.ts`).
2. **Gate** on feature flags (all default OFF).
3. **Load** `playbook_versions` definition (role DAG, WH caps, max collaboration level).
4. **Bind roles → employees** using Steward lead/role selection (`src/lib/brain/steward/lead-selection.ts`) under accessible-employee constraints.
5. **Create** `brain_runs` via `createBrainRun` / `beginUnifiedBrainRun` (`src/lib/brain/decisions/persist.ts`, `src/lib/brain/reliability/lifecycle.ts`).
6. **Create** `playbook_runs` row with `brain_run_id` (1:1 wrap) and estimated WH fields mirrored onto the Brain run budget.
7. For each ready playbook step:
   - insert `playbook_run_steps`
   - enqueue `brain_capability_steps` (link id on the playbook step)
   - claim `brain_work_leases` when Steward execution is active
8. **Advance DAG** as steps complete; publish findings into `brain_shared_findings` (with playbook/artifact extension columns).
9. On artifact-producing steps: validate → persist `artifact_versions` canonical content → quality engine → export.
10. **Complete / cancel / fail** through Brain reliability + Steward cancel paths; reconcile WH from ledger truth.

### 2.2 Mapping table

| Runtime concept | Table / module |
|-----------------|----------------|
| Playbook invocation | `playbook_runs` |
| Wrapped execution | `brain_runs` |
| Step instance | `playbook_run_steps` → `brain_capability_steps` |
| Ownership | `brain_work_leases` (`src/lib/brain/steward/leases.ts`) |
| Shared intermediate results | `brain_shared_findings` (`src/lib/brain/steward/findings.ts`) |
| Metering | `recordBrainUsage` (`src/lib/brain/metering/record-brain-usage.ts`) |
| Graph links | `insertWorkGraphEdge` (`src/lib/server/file-context.ts`) |

---

## 3. Procedure backpack

The **procedure backpack** is the sealed execution context handed to a registered procedure. It exists so playbook steps can call governed operations without letting the model invent code or shell.

### 3.1 What is in the backpack

| Field | Purpose |
|-------|---------|
| `procedureKey` / `procedureVersionId` | Exact immutable definition |
| Input/output schemas | Validate before/after execution |
| `engine` | Which runner may execute it |
| `permissions` | Explicit grants (Drive write, CRM read, export, …) |
| `network` | `none` or allowlisted hosts only |
| `timeoutMs` | Hard ceiling |
| `workspaceId` / `brainRunId` / `playbookRunStepId` | Correlation |
| `permissionEnvelope` | From Brain reliability (`src/lib/brain/reliability/permission-envelope.ts`) |
| `idempotencyKey` | For safe retries + metering |

### 3.2 V1 engines

| Engine | Runs where | Examples |
|--------|------------|----------|
| `node_builtin` | Request or worker | Schema transform, merge findings, compute hashes |
| `artifact_engine` | Request (Node libs) | pptxgenjs / docx / exceljs / pdf-lib / Playwright HTML PDF |
| `worker_libreoffice` | Worker only | Format conversion needing LibreOffice headless |
| `http_governed` | Worker/request with allowlist | Explicit partner APIs — never free-form |

### 3.3 Explicit non-goals for procedures

- No `eval`, no model-authored scripts, no unconstrained container escape.
- No silent privilege escalation beyond the backpack’s `permissions` + room envelope.
- Failures write `procedure_executions` status/error and surface through playbook step failure, not a separate opaque subsystem.

---

## 4. Artifact runtime pipeline

```text
Model / procedure output
        ↓  schema validate (schema_key + schema_version)
canonical_content + content_hash
        ↓  insert artifact_versions (status=draft|ready)
artifact_provenance rows (sources, findings, section keys)
        ↓  quality engine (+ optional artifact_reviews / approvals)
brand_kit_version applied
        ↓
src/lib/artifacts/engine/* builders
        ↓
artifact_exports + bytes → adehq-artifacts
path: workspace/{workspaceId}/artifacts/{artifactId}/versions/{versionId}/
        ↓
artifacts.current_version_id updated
work_graph_edges + optional workspace_files linkage for Drive UX
```

### 4.1 Node-capable renderers (now)

| Format | Library | Engine module |
|--------|---------|---------------|
| PPTX | `pptxgenjs` | `src/lib/artifacts/engine/presentation.ts` |
| DOCX | `docx` | `src/lib/artifacts/engine/docx.ts` |
| XLSX | `exceljs` | `src/lib/artifacts/engine/spreadsheet.ts`, `spreadsheet-enhanced.ts` |
| PDF | `pdf-lib` (+ optional Playwright HTML PDF) | `src/lib/artifacts/engine/pdf-report.ts` |

Templates continue to live in `artifact_templates` / `src/lib/artifacts/templates/**`. PR-25 adds version/brand pointers on `artifact_versions` rather than replacing the template catalog.

### 4.2 Worker-required rendering

| Work | Runner |
|------|--------|
| LibreOffice headless conversion | Worker procedure engine `worker_libreoffice` |
| Long multi-export batches | Integration/Brain worker drain paths |

### 4.3 Storage contract

- Bucket: `adehq-artifacts` (`DRIVE_BUCKETS.artifacts` in `src/lib/drive/constants.ts`)
- Path: `workspace/{workspaceId}/artifacts/{artifactId}/versions/{versionId}/`
- Object metadata should include `content_hash`, `schema_key`, and `playbook_run_id` when present.

---

## 5. Steward collaboration levels 0–3

Playbook versions declare `collaborationMaxLevel`. Runtime may use a lower level when the room is a private DM, access is restricted, or the trigger does not warrant collaboration (`src/lib/brain/steward/should-collaborate.ts`).

| Level | Name | Behavior | Maps to existing Steward modes |
|------:|------|----------|--------------------------------|
| **0** | Solo | Single employee; no shared findings board expansion | `single_employee` |
| **1** | Delegated handoff | Lead assigns sequential steps to other roles; findings `lead_only`/`room` | `delegated` |
| **2** | Parallel research | Multiple roles research concurrently; merge via findings board | `parallel_research` |
| **3** | Produce & review | Producer + independent reviewer; review step can block export | `produce_and_review` |

### 5.1 Level selection rules

1. Private DM ⇒ clamp to **level 0** (inherit today’s `private_dm` skip).
2. Never exceed `playbook_versions.collaborationMaxLevel`.
3. Employee binding must pass AI/room access checks; inaccessible roles fail closed.
4. Level 3 review failures create `artifact_reviews` (+ optional `approvals`) rather than silently exporting.
5. Leases / cancel / receipts remain in `src/lib/brain/steward/` (`leases.ts`, `cancel.ts`, `receipts.ts`, `progress.ts`).

---

## 6. Quality engine

The quality engine gates promotion from canonical draft → exportable version.

### 6.1 Checks (V1)

| Check | Source |
|-------|--------|
| Schema validation | `schema_key` / `schema_version` vs registry |
| Content hash integrity | `content_hash` over canonical JSON |
| Required sections present | Playbook `artifactIntent.sectionKeys` / template schema |
| Citation / source coverage | `artifact_provenance` + `brain_shared_findings.source_refs` |
| Brand kit applicability | `brand_kit_version_id` resolves for workspace |
| Review gate | `artifact_reviews` / `approvals` when step or level requires it |
| Privacy | DM/room visibility; reject private-DM leakage into workspace-scoped findings |

### 6.2 Outcomes

| Result | Effect |
|--------|--------|
| `pass` | Allow engine render + `artifact_exports` |
| `changes_requested` | Keep version draft; open review loop / re-run producer step |
| `blocked` | Wait on `approvals` |
| `fail` | Mark `artifact_versions.status` failed; fail playbook step |

Quality is deterministic policy + structured review — not a free-form second model that bypasses schemas.

---

## 7. Feature flags list

All default **OFF** (env unset / platform flag false ⇒ disabled). Follow the Brain flag pattern in `src/lib/brain/flags.ts` + `src/lib/admin/platform-flags.ts`.

| Flag | Env / platform key | Gates |
|------|--------------------|-------|
| Playbook runtime | `ADEHQ_PLAYBOOK_V1` / `adehq_playbook_v1` | Playbook resolve, run create, step DAG |
| Artifact structured runtime | `ADEHQ_ARTIFACT_RUNTIME_V1` / `adehq_artifact_runtime_v1` | Canonical content pipeline, provenance, exports API |
| Procedure backpack | `ADEHQ_PROCEDURE_V1` / `adehq_procedure_v1` | Registered procedure execution |
| Brand kits | `ADEHQ_BRAND_KIT_V1` / `adehq_brand_kit_v1` | Brand kit apply at render |
| Playbook UI | `NEXT_PUBLIC_ADEHQ_PLAYBOOK_V1` | Client entry points only |

Notes:

- Existing Brain/Steward flags (`ADEHQ_BRAIN_V1`, `ADEHQ_BRAIN_STEWARD_V1`, …) remain independent kill switches.
- Metering via `recordBrainUsage` is never skipped “because playbook flag is off” for calls that already executed.
- Shadow/plan-only mode (optional later) should mirror Steward shadow: plan without side effects.

---

## 8. API surface

Routes should sit beside existing artifact APIs under `src/app/api/`. All mutate paths re-check room/DM access; private DM never admin-bypasses.

### 8.1 Playbooks

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/playbooks` | List workspace-visible playbooks |
| `GET` | `/api/playbooks/[playbookId]` | Definition + current version summary |
| `POST` | `/api/playbooks/[playbookId]/runs` | Start run (room/topic/trigger message, intensity) |
| `GET` | `/api/playbook-runs/[runId]` | Status, steps, WH estimate/actual, progress |
| `POST` | `/api/playbook-runs/[runId]/cancel` | Cancel → Steward/Brain cancel path |
| `GET` | `/api/rooms/[roomId]/playbook-runs` | Room-scoped run list |

### 8.2 Procedures

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/procedures` | Registry list (metadata only) |
| `GET` | `/api/procedures/[procedureKey]` | Active version + schemas |
| `GET` | `/api/procedure-executions/[executionId]` | Execution status/result |

(Direct public “execute procedure” is not required in V1 if playbook steps are the only caller.)

### 8.3 Artifacts (structured runtime)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/artifacts` / `/api/artifacts/[artifactId]` | Existing list/detail — extend payload with `kind`, `current_version_id` |
| `GET` | `/api/artifacts/[artifactId]/versions` | Version list (schema/hash/status) |
| `GET` | `/api/artifacts/[artifactId]/versions/[versionId]` | Canonical content (authorized) |
| `POST` | `/api/artifacts/[artifactId]/versions/[versionId]/export` | Render export via engine |
| `GET` | `/api/artifacts/[artifactId]/exports` | Export history |
| `POST` | `/api/artifacts/[artifactId]/versions/[versionId]/reviews` | Submit review decision |
| `GET` | `/api/topics/[topicId]/artifacts` | Existing topic list — inherits topic/room auth |

### 8.4 Brand kits

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/brand-kits` | Workspace kits |
| `POST` | `/api/brand-kits` | Create kit (admin) |
| `POST` | `/api/brand-kits/[kitId]/versions` | Publish kit version (admin) |

### 8.5 Server modules (target layout)

```text
src/lib/playbooks/           # definitions, run orchestrator, role bind
src/lib/procedures/          # registry, backpack, engines
src/lib/artifacts/runtime/   # canonical validate, provenance, quality, export
src/lib/brand-kits/          # kit resolve + apply
# reuse:
src/lib/brain/               # createBrainRun, recordBrainUsage, reliability
src/lib/brain/steward/       # leases, findings, role selection, cancel
src/lib/artifacts/engine/    # existing builders
src/lib/server/file-context.ts
src/lib/workspace/access/
src/lib/server/room-access.ts
```

---

## 9. Out of scope (V1)

| Out of scope | Reason |
|--------------|--------|
| Arbitrary model-authored code / sandboxed user scripts | Locked decision #3 |
| Parallel `brain_steps` / `files` / cost ledger tables | Audit forbids duplicates |
| Customer-facing model SKUs or work-minutes UX | WH-only product meter |
| Admin bypass into private DM playbooks/artifacts | Privacy inheritance |
| Replacing existing pptx/docx/xlsx/pdf builders | Extend via canonical content |
| Fully autonomous cross-workspace playbooks | Workspace-scoped only |
| Real-time multiplayer canvas editing of OOXML | Canonical JSON is the edit surface |
| Training / fine-tuning pipelines | Separate product track |
| Mintlify customer docs rewrite | Engineering docs first; Mintlify later |

---

## 10. Acceptance tests (runtime)

1. **Wrap invariant:** creating a playbook run creates exactly one `brain_runs` row and links steps to `brain_capability_steps`.
2. **Canonical-first:** export endpoints refuse when `canonical_content` is missing/invalid.
3. **No OOXML from models:** fixture asserts builders receive structured JSON only.
4. **DM privacy:** member A’s private DM playbook artifacts are invisible to admin B without peer identity.
5. **WH path:** provider calls in a playbook step produce `ai_cost_ledger_entries` via `recordBrainUsage`; estimate vs actual appears on run receipt.
6. **Procedure seal:** unregistered procedure keys cannot execute even if the model asks.
7. **Flags off:** with defaults OFF, APIs return disabled / legacy path; no table writes for playbook runs.
8. **LibreOffice boundary:** conversion jobs only scheduled on worker engine, not inline request.

These tests, plus the audit checklist, are the PR-25 done definition for the architecture phase.
