-- AdeHQ V19.6.1 — Files + Artifacts data layer

create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and coalesce(wm.status, 'active') = 'active'
  );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-files',
  'workspace-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'text/markdown',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text,
  topic_id text,
  uploaded_by_user_id uuid,
  original_name text not null,
  display_name text not null,
  mime_type text not null,
  extension text not null,
  size_bytes bigint not null,
  storage_bucket text not null default 'workspace-files',
  storage_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  parse_status text
    check (parse_status is null or parse_status in ('pending', 'processing', 'parsed', 'no_text', 'failed')),
  extracted_text text,
  text_preview text,
  page_count integer,
  sheet_count integer,
  row_count integer,
  checksum text,
  source_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete set null
);

create table if not exists public.file_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null references public.workspace_files(id) on delete cascade,
  room_id text,
  topic_id text,
  chunk_index integer not null,
  content text not null,
  content_preview text,
  page_start integer,
  page_end integer,
  sheet_name text,
  row_start integer,
  row_end integer,
  token_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  embedding_status text not null default 'not_started',
  created_at timestamptz not null default now(),
  unique (file_id, chunk_index),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete set null
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text,
  topic_id text,
  title text not null,
  artifact_type text not null
    check (artifact_type in (
      'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
      'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision', 'note', 'other'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'saved', 'archived')),
  content_markdown text not null,
  content_json jsonb not null default '{}'::jsonb,
  created_by_type text not null check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text,
  source_file_ids uuid[] not null default '{}'::uuid[],
  source_message_ids text[] not null default '{}'::text[],
  source_chunk_ids uuid[] not null default '{}'::uuid[],
  source_citations jsonb not null default '[]'::jsonb,
  memory_saved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete set null
);

create table if not exists public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  version_number integer not null,
  content_markdown text not null,
  content_json jsonb not null default '{}'::jsonb,
  source_citations jsonb not null default '[]'::jsonb,
  created_by_type text not null check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text,
  created_at timestamptz not null default now(),
  unique (artifact_id, version_number)
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id text not null,
  file_id uuid references public.workspace_files(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  attachment_type text not null check (attachment_type in ('file', 'artifact')),
  created_at timestamptz not null default now(),
  check (
    (attachment_type = 'file' and file_id is not null and artifact_id is null)
    or (attachment_type = 'artifact' and artifact_id is not null and file_id is null)
  )
);

create table if not exists public.work_graph_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_object_type text not null,
  from_object_id text not null,
  relation_type text not null,
  to_object_type text not null,
  to_object_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_files_workspace_topic
  on public.workspace_files(workspace_id, topic_id, created_at desc);
create index if not exists idx_workspace_files_workspace_room
  on public.workspace_files(workspace_id, room_id, created_at desc);
create index if not exists idx_file_chunks_file
  on public.file_chunks(file_id, chunk_index);
create index if not exists idx_artifacts_workspace_topic
  on public.artifacts(workspace_id, topic_id, created_at desc);
create index if not exists idx_artifact_versions_artifact
  on public.artifact_versions(artifact_id, version_number desc);
create index if not exists idx_message_attachments_message
  on public.message_attachments(workspace_id, message_id);
create index if not exists idx_work_graph_edges_from
  on public.work_graph_edges(workspace_id, from_object_type, from_object_id);
create index if not exists idx_work_graph_edges_to
  on public.work_graph_edges(workspace_id, to_object_type, to_object_id);

drop trigger if exists set_workspace_files_updated_at on public.workspace_files;
create trigger set_workspace_files_updated_at
before update on public.workspace_files
for each row execute function public.set_updated_at();

drop trigger if exists set_artifacts_updated_at on public.artifacts;
create trigger set_artifacts_updated_at
before update on public.artifacts
for each row execute function public.set_updated_at();

alter table public.workspace_files enable row level security;
alter table public.file_chunks enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.message_attachments enable row level security;
alter table public.work_graph_edges enable row level security;

drop policy if exists "workspace_files_select_member" on public.workspace_files;
create policy "workspace_files_select_member"
on public.workspace_files for select
using (public.is_active_workspace_member(workspace_id));

drop policy if exists "workspace_files_insert_member" on public.workspace_files;
create policy "workspace_files_insert_member"
on public.workspace_files for insert
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "workspace_files_update_member" on public.workspace_files;
create policy "workspace_files_update_member"
on public.workspace_files for update
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "workspace_files_delete_admin_or_uploader" on public.workspace_files;
create policy "workspace_files_delete_admin_or_uploader"
on public.workspace_files for delete
using (
  public.is_workspace_admin(workspace_id)
  or uploaded_by_user_id = auth.uid()
);

drop policy if exists "file_chunks_member" on public.file_chunks;
create policy "file_chunks_member"
on public.file_chunks for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "artifacts_member" on public.artifacts;
create policy "artifacts_member"
on public.artifacts for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "artifact_versions_member" on public.artifact_versions;
create policy "artifact_versions_member"
on public.artifact_versions for all
using (
  exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and public.is_active_workspace_member(a.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and public.is_active_workspace_member(a.workspace_id)
  )
);

drop policy if exists "message_attachments_member" on public.message_attachments;
create policy "message_attachments_member"
on public.message_attachments for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "work_graph_edges_member" on public.work_graph_edges;
create policy "work_graph_edges_member"
on public.work_graph_edges for all
using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

drop policy if exists "workspace_files_storage_select_member" on storage.objects;
create policy "workspace_files_storage_select_member"
on storage.objects for select
using (
  bucket_id = 'workspace-files'
  and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "workspace_files_storage_insert_member" on storage.objects;
create policy "workspace_files_storage_insert_member"
on storage.objects for insert
with check (
  bucket_id = 'workspace-files'
  and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "workspace_files_storage_update_member" on storage.objects;
create policy "workspace_files_storage_update_member"
on storage.objects for update
using (
  bucket_id = 'workspace-files'
  and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'workspace-files'
  and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "workspace_files_storage_delete_admin" on storage.objects;
create policy "workspace_files_storage_delete_admin"
on storage.objects for delete
using (
  bucket_id = 'workspace-files'
  and public.is_workspace_admin(((storage.foldername(name))[1])::uuid)
);
