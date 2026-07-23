-- PR-25 follow-up: write policies required for live playbook execution.
-- Initial migration only granted SELECT on playbook_run_steps / several tables.

-- ---------------------------------------------------------------------------
-- playbook_run_steps — initiator (or room participant) may insert/update
-- ---------------------------------------------------------------------------
drop policy if exists playbook_run_steps_insert on public.playbook_run_steps;
create policy playbook_run_steps_insert on public.playbook_run_steps
for insert to authenticated
with check (
  exists (
    select 1 from public.playbook_runs r
    where r.id = playbook_run_id
      and public.is_workspace_member(r.workspace_id)
      and (
        r.initiated_by_user_id = auth.uid()
        or (r.room_id is not null and public.can_access_room_row(r.workspace_id, r.room_id))
      )
  )
);

drop policy if exists playbook_run_steps_update on public.playbook_run_steps;
create policy playbook_run_steps_update on public.playbook_run_steps
for update to authenticated
using (
  exists (
    select 1 from public.playbook_runs r
    where r.id = playbook_run_id
      and public.is_workspace_member(r.workspace_id)
      and (
        r.initiated_by_user_id = auth.uid()
        or public.is_workspace_admin(r.workspace_id)
        or (r.room_id is not null and public.can_access_room_row(r.workspace_id, r.room_id))
      )
  )
)
with check (
  exists (
    select 1 from public.playbook_runs r
    where r.id = playbook_run_id
      and public.is_workspace_member(r.workspace_id)
  )
);

-- ---------------------------------------------------------------------------
-- artifact_exports / reviews / provenance writes for workspace members with
-- room access (server still uses service-role for most mutations).
-- ---------------------------------------------------------------------------
drop policy if exists artifact_exports_insert on public.artifact_exports;
create policy artifact_exports_insert on public.artifact_exports
for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

drop policy if exists artifact_reviews_insert on public.artifact_reviews;
create policy artifact_reviews_insert on public.artifact_reviews
for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

drop policy if exists artifact_provenance_insert on public.artifact_provenance;
create policy artifact_provenance_insert on public.artifact_provenance
for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1
    from public.artifact_versions av
    join public.artifacts a on a.id = av.artifact_id
    where av.id = artifact_version_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

comment on policy playbook_run_steps_insert on public.playbook_run_steps is
  'PR-25 live: run initiator/participants may create step rows.';
comment on policy playbook_run_steps_update on public.playbook_run_steps is
  'PR-25 live: run initiator/participants may advance step status.';
