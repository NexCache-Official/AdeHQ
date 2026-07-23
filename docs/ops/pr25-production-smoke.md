# PR-25 production smoke (live, not demo)

Use this when validating Playbooks / Artifacts against a real Supabase workspace.
Demo mode (`Continue as Demo Founder`) is **not** a production proof — it uses
client-side seed catalogs and sessionStorage progress only.

## Preconditions

1. Apply migrations (in order):
   - `20260723200000_pr25_playbook_artifact_runtime.sql`
   - `20260723210000_pr25_playbook_runtime_rls_writes.sql`
2. Set **server** flags in the deployment environment:
   ```
   ADEHQ_PLAYBOOK_RUNTIME_V1=1
   ADEHQ_ARTIFACT_RUNTIME_V1=1
   ADEHQ_PROCEDURE_RUNTIME_V1=1
   ADEHQ_ARTIFACT_EXPORT_V1=1
   ADEHQ_PLAYBOOK_WORKER_MODE=inline
   ```
3. Set **public** flags and **redeploy** (Next inlines `NEXT_PUBLIC_*` at build):
   ```
   NEXT_PUBLIC_ADEHQ_PLAYBOOKS_V1=1
   NEXT_PUBLIC_ADEHQ_ARTIFACTS_V1=1
   ```
4. Confirm `/api/build-info` shows:
   - `playbookRuntimeV1: true`
   - `artifactRuntimeV1: true`
   - `procedureRuntimeV1: true`
   - `migrationVersion` ≥ `20260723210000`

## Business-owner path (manual)

1. Sign in with a real workspace account (not demo).
2. Confirm sidebar shows **Playbooks** and **Artifacts**.
3. Open `/playbooks` — seed/platform playbooks list (DB-backed when materialized).
4. Open **Competitor Analysis** (or Research to Executive Report).
5. Fill required inputs, select accessible AI employees, start run.
6. On `/playbooks/runs/[runId]`:
   - Status moves `queued` → `running` → `completed` (or `failed` with safe error)
   - Steps advance via `POST /api/playbook-runs/:id/process` (UI polls this)
   - `brain_run_id` is non-null on the run row
7. Open `/artifacts` — composed artifacts from `artifact_compose` steps appear.
8. Open an artifact → Export DOCX/PPTX/XLSX (requires export flag) → file opens.

## Database checks

```sql
select id, status, brain_run_id, actual_wh
from playbook_runs
order by created_at desc limit 5;

select step_key, status, brain_step_id, output_artifact_id, actual_wh
from playbook_run_steps
where playbook_run_id = '<run_id>'
order by created_at;

select id, title, kind, current_version_id
from artifacts
where metadata->>'playbook_run_id' = '<run_id>'
   or id in (
     select output_artifact_id from playbook_run_steps
     where playbook_run_id = '<run_id>' and output_artifact_id is not null
   );
```

## Known V1 limits (still live, not demo)

- Reasoning/search steps persist structured placeholders unless Brain search/reasoning
  is separately invoked — procedures + artifact compose/export are the deterministic core.
- LibreOffice PDF preview conversion is worker-only.
- Maya custom playbook builder remains behind `ADEHQ_CUSTOM_PLAYBOOKS_V1=0`.

## Offline CI still required

```bash
npx tsc --noEmit
npm run test:pr25
npm run verify:release
```
