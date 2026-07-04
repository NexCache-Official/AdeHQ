-- AdeHQ Drive — native file layer (Phase 4.5)

-- ---------------------------------------------------------------------------
-- Storage buckets (private, app-level quotas enforced in API)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'adehq-files',
    'adehq-files',
    false,
    10485760,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'text/markdown',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/octet-stream'
    ]
  ),
  (
    'adehq-artifacts',
    'adehq-artifacts',
    false,
    52428800,
    array['text/markdown', 'text/plain', 'application/json', 'application/pdf', 'application/octet-stream']
  ),
  (
    'adehq-browser-evidence',
    'adehq-browser-evidence',
    false,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'text/html', 'application/pdf', 'application/octet-stream']
  ),
  (
    'adehq-exports',
    'adehq-exports',
    false,
    52428800,
    array[
      'text/markdown', 'text/plain', 'text/csv', 'application/json',
      'application/pdf', 'application/zip', 'application/octet-stream'
    ]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Drive folders
-- ---------------------------------------------------------------------------
create table if not exists public.drive_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.drive_folders(id) on delete cascade,
  name text not null,
  section text not null default 'files'
    check (section in ('files', 'artifacts', 'evidence', 'exports')),
  created_by_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, parent_id, section, name)
);

create index if not exists idx_drive_folders_workspace
  on public.drive_folders (workspace_id, section, parent_id);

alter table public.workspace_files
  add column if not exists drive_folder_id uuid references public.drive_folders(id) on delete set null;

alter table public.workspace_files
  add column if not exists drive_section text not null default 'files'
    check (drive_section in ('files', 'artifacts', 'evidence', 'exports'));

alter table public.artifacts
  add column if not exists drive_folder_id uuid references public.drive_folders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Browser evidence & exports
-- ---------------------------------------------------------------------------
create table if not exists public.browser_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text,
  topic_id text,
  drive_folder_id uuid references public.drive_folders(id) on delete set null,
  title text not null,
  description text,
  storage_bucket text not null default 'adehq-browser-evidence',
  storage_path text not null,
  mime_type text not null default 'image/png',
  size_bytes bigint not null default 0,
  source_url text,
  captured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete set null
);

create index if not exists idx_browser_evidence_workspace
  on public.browser_evidence (workspace_id, created_at desc);

create table if not exists public.drive_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text,
  topic_id text,
  drive_folder_id uuid references public.drive_folders(id) on delete set null,
  title text not null,
  export_type text not null default 'report'
    check (export_type in ('report', 'summary', 'memory', 'artifact_bundle', 'other')),
  storage_bucket text not null default 'adehq-exports',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  source_artifact_ids uuid[] not null default '{}'::uuid[],
  source_file_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drive_exports_workspace
  on public.drive_exports (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- App-level storage quotas & usage ledger
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_storage_quotas (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_tier text not null default 'free'
    check (plan_tier in ('free', 'pro', 'team', 'enterprise')),
  max_workspace_bytes bigint not null default 104857600,
  max_file_bytes bigint not null default 10485760,
  used_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.storage_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid,
  event_type text not null
    check (event_type in ('upload', 'delete', 'export', 'artifact_save', 'adjustment')),
  bucket text not null,
  object_path text,
  size_bytes bigint not null default 0,
  delta_bytes bigint not null default 0,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_storage_usage_events_workspace
  on public.storage_usage_events (workspace_id, created_at desc);

-- Seed quotas for existing workspaces from current file usage
insert into public.workspace_storage_quotas (workspace_id, plan_tier, used_bytes)
select
  w.id,
  'free',
  coalesce(
    (
      select sum(wf.size_bytes)::bigint
      from public.workspace_files wf
      where wf.workspace_id = w.id
        and wf.status in ('ready', 'uploaded', 'processing')
    ),
    0
  )
    + coalesce(
      (
        select sum(be.size_bytes)::bigint
        from public.browser_evidence be
        where be.workspace_id = w.id
      ),
      0
    )
    + coalesce(
      (
        select sum(de.size_bytes)::bigint
        from public.drive_exports de
        where de.workspace_id = w.id
      ),
      0
    )
from public.workspaces w
on conflict (workspace_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.drive_folders enable row level security;
alter table public.browser_evidence enable row level security;
alter table public.drive_exports enable row level security;
alter table public.workspace_storage_quotas enable row level security;
alter table public.storage_usage_events enable row level security;

drop policy if exists "drive_folders_member" on public.drive_folders;
create policy "drive_folders_member"
on public.drive_folders for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "browser_evidence_member" on public.browser_evidence;
create policy "browser_evidence_member"
on public.browser_evidence for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "drive_exports_member" on public.drive_exports;
create policy "drive_exports_member"
on public.drive_exports for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "workspace_storage_quotas_member" on public.workspace_storage_quotas;
drop policy if exists "workspace_storage_quotas_admin" on public.workspace_storage_quotas;
drop policy if exists "workspace_storage_quotas_member_write" on public.workspace_storage_quotas;
create policy "workspace_storage_quotas_member_write"
on public.workspace_storage_quotas for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "storage_usage_events_member" on public.storage_usage_events;
create policy "storage_usage_events_member"
on public.storage_usage_events for select
using (public.is_active_workspace_member(workspace_id));

drop policy if exists "storage_usage_events_insert" on public.storage_usage_events;
create policy "storage_usage_events_insert"
on public.storage_usage_events for insert
with check (public.is_active_workspace_member(workspace_id));

-- Storage policies for AdeHQ Drive buckets
do $$
declare
  bucket_id text;
begin
  foreach bucket_id in array array['adehq-files', 'adehq-artifacts', 'adehq-browser-evidence', 'adehq-exports']
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      bucket_id || '_select_member'
    );
    execute format(
      $p$
      create policy %I
      on storage.objects for select
      using (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_select_member',
      bucket_id
    );

    execute format(
      'drop policy if exists %I on storage.objects',
      bucket_id || '_insert_member'
    );
    execute format(
      $p$
      create policy %I
      on storage.objects for insert
      with check (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_insert_member',
      bucket_id
    );

    execute format(
      'drop policy if exists %I on storage.objects',
      bucket_id || '_update_member'
    );
    execute format(
      $p$
      create policy %I
      on storage.objects for update
      using (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      with check (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_update_member',
      bucket_id,
      bucket_id
    );

    execute format(
      'drop policy if exists %I on storage.objects',
      bucket_id || '_delete_member'
    );
    execute format(
      $p$
      create policy %I
      on storage.objects for delete
      using (
        bucket_id = %L
        and (
          public.is_workspace_admin(((storage.foldername(name))[1])::uuid)
          or exists (
            select 1 from public.workspace_files wf
            where wf.storage_path = name
              and wf.storage_bucket = %L
              and wf.uploaded_by_user_id = auth.uid()
          )
        )
      )
      $p$,
      bucket_id || '_delete_member',
      bucket_id,
      bucket_id
    );
  end loop;
end $$;

drop trigger if exists set_drive_folders_updated_at on public.drive_folders;
create trigger set_drive_folders_updated_at
before update on public.drive_folders
for each row execute function public.set_updated_at();

drop trigger if exists set_browser_evidence_updated_at on public.browser_evidence;
create trigger set_browser_evidence_updated_at
before update on public.browser_evidence
for each row execute function public.set_updated_at();

drop trigger if exists set_drive_exports_updated_at on public.drive_exports;
create trigger set_drive_exports_updated_at
before update on public.drive_exports
for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_storage_quotas_updated_at on public.workspace_storage_quotas;
create trigger set_workspace_storage_quotas_updated_at
before update on public.workspace_storage_quotas
for each row execute function public.set_updated_at();
