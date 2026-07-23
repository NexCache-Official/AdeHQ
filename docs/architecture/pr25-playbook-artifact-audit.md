# PR-25 — Playbook & Artifact System Audit

> Status: **architecture lock (pre-implementation)**  
> Companion runtime design: [`pr25-playbook-artifact-runtime.md`](./pr25-playbook-artifact-runtime.md)  
> Grounded Brain spine: [`adehq-brain.md`](./adehq-brain.md)  
> Roles: **`admin` | `member` only** (`src/lib/workspace/permissions.ts`)

This audit decides what PR-25 **extends**, what it **adds**, and what it must **never duplicate**. AdeHQ already has Brain runs, artifact builders, Drive files, Work Graph, approvals, and WH metering. PR-25 layers playbooks, procedures, structured artifact provenance, and brand kits on top of that spine.

---

## 1. Verdict

PR-25 is **additive orchestration + structured artifact lifecycle**, not a parallel Brain or Drive rewrite.

| Concern | Verdict |
|--------|---------|
| Brain execution / metering / leases / findings | **Extend & reuse** — never fork |
| Artifact row identity + version history | **Extend** `artifacts` / `artifact_versions` |
| File bytes + chunk retrieval | **Reuse** `workspace_files` / `file_chunks` |
| Work Graph linkage | **Reuse** `work_graph_edges` via `insertWorkGraphEdge` |
| Approvals / WH ledgers | **Reuse** existing tables + `recordBrainUsage` |
| Playbooks / procedures / exports / provenance / brand kits | **New tables only** |

**Hard rule:** do not invent parallel tables for Brain steps, files, cost ledgers, or Work Graph edges. Exact names below are the contract.

---

## 2. Tables to EXTEND (do not duplicate)

### 2.1 Brain spine

| Table | Why it stays canonical |
|-------|------------------------|
| `brain_runs` | One execution envelope per AI run; playbook run wraps exactly one of these |
| `brain_capability_steps` | **Not** `brain_steps`. Playbook run steps link here |
| `brain_decision_attempts` | Route / intensity decisions stay on Brain |
| `brain_work_leases` | Steward step ownership (`src/lib/brain/steward/leases.ts`) |
| `brain_shared_findings` | Collaborator board; extended for playbook/artifact section refs |

### 2.2 Artifact spine

| Table | Why it stays canonical |
|-------|------------------------|
| `artifacts` | Logical artifact identity (room/topic/workspace scoped) |
| `artifact_versions` | Version history; gains structured canonical content + provenance FKs |
| `artifact_templates` | Template catalog already used by engine builders |
| `artifact_runs` | Tool/job → artifact generation audit trail |

### 2.3 Files / graph / governance / metering

| Table | Why it stays canonical |
|-------|------------------------|
| `workspace_files` | **Not** `files`. Uploaded / stored file rows |
| `file_chunks` | Retrieval chunks for context fabric |
| `work_graph_edges` | Cross-object links (playbook ↔ artifact ↔ room ↔ task) |
| `approvals` | Human gates for consequential steps / exports |
| `ai_cost_ledger_entries` | Immutable commercial ledger |
| `ai_work_minutes_ledger` | Legacy minutes ledger (do not reintroduce as customer UX) |
| `workspace_usage_periods` | Weekly WH capacity / rollups |

### 2.4 Additive columns on existing tables

#### `artifacts`

| Column | Purpose |
|--------|---------|
| `kind` | Structured kind discriminator (presentation, workbook, document, report, …) |
| `current_version_id` | Pointer to active `artifact_versions.id` |
| `work_item_id` | Optional link into task/work-item identity when the artifact is deliverable work |

#### `artifact_versions`

| Column | Purpose |
|--------|---------|
| `schema_key` | Canonical content schema id |
| `schema_version` | Schema revision |
| `canonical_content` | Structured JSON **before** OOXML/PDF bytes |
| `content_hash` | Hash of canonical content (integrity / dedupe / review) |
| `template_version_id` | Which template revision produced this version |
| `brand_kit_version_id` | Which brand kit version was applied |
| `brain_run_id` | Producing Brain run |
| `playbook_run_id` | Producing playbook run (when applicable) |
| `origin` | How the version was created (playbook / steward / tool / human / import) |
| `status` | Version lifecycle (`draft` / `ready` / `failed` / `superseded` / …) |

#### `brain_shared_findings`

| Column | Purpose |
|--------|---------|
| `playbook_run_id` | Tie finding to playbook execution |
| `playbook_run_step_id` | Tie finding to playbook step |
| `artifact_id` | Artifact the finding concerns |
| `artifact_section_key` | Section-level attachment inside canonical content |
| `finding_type` | Typed finding class (claim, risk, citation, review_note, …) |
| `source_refs` | Structured source references (chunk/file/message ids) |

---

## 3. Tables to ADD (additive only)

### 3.1 Playbooks

| Table | Role |
|-------|------|
| `playbooks` | Workspace (or platform-seeded) playbook definition identity |
| `playbook_versions` | Immutable versioned DAG / role-mapped steps / WH estimates |
| `playbook_runs` | One invocation instance; wraps **one** `brain_run` |
| `playbook_run_steps` | Per-step instance; links to `brain_capability_steps` |

Playbook definitions reference **roles**, not employee IDs. Employee binding happens at run time via Steward role selection (`src/lib/brain/steward/lead-selection.ts` and related).

### 3.2 Procedures

| Table | Role |
|-------|------|
| `procedure_registry` | Named, governed procedure catalog |
| `procedure_versions` | Immutable procedure definition (inputs, outputs, engine, constraints) |
| `procedure_executions` | One execution row per invocation (status, inputs, outputs, errors) |

**V1 constraint:** no arbitrary AI code execution. Procedures are registered, reviewed, and executed by AdeHQ-owned runners only.

### 3.3 Artifact quality / export / brand

| Table | Role |
|-------|------|
| `artifact_exports` | Materialized file exports (pptx/docx/xlsx/pdf/…) pointing at storage |
| `artifact_provenance` | Lineage: sources → findings → sections → version |
| `artifact_reviews` | Human/AI review decisions against a version |
| `workspace_brand_kits` | Workspace brand kit identity |
| `workspace_brand_kit_versions` | Versioned tokens/assets used at render time |

---

## 4. Lifecycle reuse (do not reimplement)

| Lifecycle concern | Canonical path | PR-25 reuse |
|-------------------|----------------|-------------|
| Create Brain run | `createBrainRun` (`src/lib/brain/decisions/persist.ts`) / `beginUnifiedBrainRun` (`src/lib/brain/reliability/lifecycle.ts`) | `playbook_runs.brain_run_id` points at this run |
| Enqueue capability steps | `enqueueBrainStep` / insert into `brain_capability_steps` | Each `playbook_run_steps` row links one (or more staged) capability step(s) |
| Metering / WH | `recordBrainUsage` (`src/lib/brain/metering/record-brain-usage.ts`) → `recordCostEvent` → `ai_cost_ledger_entries` + `workspace_usage_periods` | Estimate at plan time; reconcile on every provider call |
| Steward leases | `src/lib/brain/steward/leases.ts` → `brain_work_leases` | Playbook multi-role waves claim leases on capability steps |
| Shared findings | `src/lib/brain/steward/findings.ts` → `brain_shared_findings` | Extended columns for playbook/artifact section anchoring |
| Cancel / fail | `src/lib/brain/steward/cancel.ts` + reliability lifecycle | Playbook run cancellation cancels wrapped `brain_run` and open leases |
| Artifact builders | `src/lib/artifacts/engine/` (`presentation.ts`, `docx.ts`, `spreadsheet*.ts`, `pdf-report.ts`) | Consume **canonical_content**, never model OOXML |
| Work Graph | `insertWorkGraphEdge` (`src/lib/server/file-context.ts`) | Link playbook_run ↔ artifact ↔ room/topic/work item |
| Access checks | `src/lib/workspace/access/` + `src/lib/server/room-access.ts` | Private DM: **no admin bypass** |

Customer-facing unit remains **Work Hours** (WH). Do not surface model SKUs or resurrect “work minutes” as the product meter.

---

## 5. Playbook step → `brain_capability_steps` mapping

```text
playbook_versions (role-keyed DAG)
        │
        ▼
playbook_runs  ──────── wraps ────────►  brain_runs (exactly one)
        │
        ▼
playbook_run_steps
        │  role → employee resolved at runtime
        │  estimated WH copied onto capability step budgets
        ▼
brain_capability_steps  ◄── linked by playbook_run_steps.brain_capability_step_id
        │
        ├─ brain_work_leases (Steward ownership)
        ├─ brain_decision_attempts (route selection)
        └─ recordBrainUsage (actual WH)
```

Rules:

1. **`playbook_run` wraps one `brain_run`.** No second execution envelope.
2. Every executable playbook step materializes (or binds) a `brain_capability_steps` row. There is no parallel `brain_steps` table.
3. Step status for UI may be denormalized on `playbook_run_steps`, but authority for lease/cancel/retry stays on Brain reliability + Steward.
4. Findings published mid-run set `playbook_run_id` / `playbook_run_step_id` on `brain_shared_findings` when the finding originated from a playbook step.

---

## 6. Private DM enforcement

Inherited from current access + Steward privacy:

| Layer | Behavior |
|-------|----------|
| Room auth | `canAccessRoom` in `src/lib/workspace/access/decisions.ts` — DM is owner/peer identity only; **never admin bypass** |
| Room access helpers | `src/lib/server/room-access.ts` — same identity rules for API routes |
| Steward trigger | `shouldCollaborate` skips collaboration when `isPrivateDm` (`skipReasons: ["private_dm"]`) |
| Findings | `publishSharedFinding` hard-rejects `containsPrivateDmContext` |

PR-25 inheritance rules:

- A playbook started in a private DM **does not** expand into multi-employee collaboration by default.
- Artifacts / exports / findings created in a DM inherit DM visibility (not workspace-wide).
- Brand kits and templates may be workspace-scoped, but **content and provenance** remain room-scoped with the DM.
- Admins cannot read private DM playbook runs or artifact content via role alone.

Workspace roles remain **`admin` | `member` only**.

---

## 7. WH estimate / reconcile via `recordBrainUsage`

| Phase | What happens |
|-------|----------------|
| Plan / start | Playbook version + Steward plan produce `estimatedWhMin` / `estimatedWhMax` / `hardWhLimit` on the Brain run (reliability lifecycle fields) |
| Per step | Capability step carries `estimated_*_cost_usd` / max ceiling; UI shows WH |
| Provider call | **Every** billable call goes through `recordBrainUsage` with idempotency key |
| Reconcile | `brain_runs.actual_wh` (and period rollups) reflect ledger truth; playbook receipts summarize estimate vs actual |
| Cancel | Partial WH for tokens already spent — same cancel path as Steward / reliability |

Do **not** write WH by updating `workspace_usage_periods` or inventing a playbook-specific ledger. The metering spine is the only write path that matters for customer-facing WH.

---

## 8. What runs in the request vs worker

### 8.1 Request path (Node / Next.js capable now)

Safe to run inline (or short async on the app runtime):

| Work | Libraries / modules |
|------|---------------------|
| Canonical content generation / validation | Brain routes + schema validators |
| PPTX build | `pptxgenjs` — `src/lib/artifacts/engine/presentation.ts` |
| DOCX build | `docx` — `src/lib/artifacts/engine/docx.ts` |
| XLSX build | `exceljs` — `src/lib/artifacts/engine/spreadsheet.ts`, `spreadsheet-enhanced.ts` |
| PDF build | `pdf-lib` and optional Playwright HTML PDF — `src/lib/artifacts/engine/pdf-report.ts` |
| Playbook plan + Brain run create | request / queue kickoff |
| Access checks, approvals create, Work Graph edges | request |

### 8.2 Worker-required

| Work | Why |
|------|-----|
| LibreOffice headless conversion | Binary / long-running / not serverless-safe |
| Heavy multi-step playbook waves | Lease heartbeats, retries, multi-employee DAG advance |
| Large export packaging / Drive sync bursts | Time + memory bounds |

Storage for materialized versions:

```text
bucket: adehq-artifacts
path:   workspace/{workspaceId}/artifacts/{artifactId}/versions/{versionId}/
```

(`DRIVE_BUCKETS.artifacts` in `src/lib/drive/constants.ts`.)

---

## 9. Architectural decisions (locked)

1. **Canonical structured content before file generation.** Models emit schema-validated JSON into `artifact_versions.canonical_content`. Models **never** emit OOXML/PDF bytes.
2. **Playbooks reference roles, not employee IDs.** Runtime binding uses Steward role selection under access constraints.
3. **No arbitrary AI code execution in V1.** Only registered procedures in `procedure_registry` / `procedure_versions`.
4. **`playbook_run` wraps one `brain_run`; `playbook_run_step` links `brain_capability_steps`.**
5. **Private DM privacy inheritance** — no admin bypass; no silent collaboration expansion.
6. **Work Hours are the customer-facing unit** (`recordBrainUsage` → ledger → periods).
7. **Feature flags default OFF** until playbook/artifact runtime paths graduate (see runtime doc).

---

## 10. Anti-patterns (explicitly out of audit scope as “do not build”)

| Anti-pattern | Why rejected |
|--------------|--------------|
| New `brain_steps` table | Canonical table is `brain_capability_steps` |
| New `files` table | Canonical table is `workspace_files` (+ `file_chunks`) |
| Parallel cost ledger for playbooks | Use `ai_cost_ledger_entries` via `recordBrainUsage` |
| Parallel Work Graph | Use `work_graph_edges` + `insertWorkGraphEdge` |
| Duplicate artifact binary store beside `adehq-artifacts` | One bucket contract |
| Employee IDs baked into playbook versions | Roles only |
| Model-produced `.pptx` / `.docx` XML | Canonical content → engine builders |

---

## 11. Implementation checklist (audit acceptance)

- [ ] Migrations **alter** listed extend tables; **create** only the additive set above
- [ ] `playbook_runs` has a single non-null `brain_run_id` (1:1 wrap)
- [ ] `playbook_run_steps` FK/link to `brain_capability_steps` (not a new step table)
- [ ] Artifact pipeline writes `canonical_content` + `content_hash` before export bytes
- [ ] Exports land under `adehq-artifacts` path `workspace/{id}/artifacts/{id}/versions/{v}/`
- [ ] Private DM playbook/artifact APIs use `workspace/access` + `room-access` (no admin bypass)
- [ ] All WH mutations go through `recordBrainUsage`
- [ ] Flags default OFF
- [ ] Roles remain `admin` | `member` only

When this checklist is green, implement against [`pr25-playbook-artifact-runtime.md`](./pr25-playbook-artifact-runtime.md).
