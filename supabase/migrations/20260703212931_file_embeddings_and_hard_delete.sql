-- File chunk embeddings (pgvector) + hard-delete storage policy + general-topic backfill

create extension if not exists vector with schema extensions;

alter table public.file_chunks
  add column if not exists embedding extensions.vector(1024);

alter table public.file_chunks
  drop constraint if exists file_chunks_embedding_status_check;

alter table public.file_chunks
  add constraint file_chunks_embedding_status_check
  check (embedding_status in ('not_started', 'pending', 'completed', 'failed'));

create index if not exists idx_file_chunks_embedding
  on public.file_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

-- Backfill orphan files to the room's General topic
update public.workspace_files wf
set topic_id = t.id,
    updated_at = now()
from public.topics t
where wf.topic_id is null
  and wf.room_id is not null
  and wf.room_id = t.room_id
  and wf.workspace_id = t.workspace_id
  and lower(t.title) = 'general';

update public.file_chunks fc
set topic_id = wf.topic_id
from public.workspace_files wf
where fc.file_id = wf.id
  and fc.topic_id is null
  and wf.topic_id is not null;

create or replace function public.match_file_chunks(
  p_workspace_id uuid,
  p_topic_id text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 8,
  p_file_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  file_id uuid,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    fc.id as chunk_id,
    fc.file_id,
    (1 - (fc.embedding <=> p_query_embedding))::double precision as similarity
  from public.file_chunks fc
  join public.workspace_files wf on wf.id = fc.file_id
  where fc.workspace_id = p_workspace_id
    and wf.topic_id = p_topic_id
    and wf.status in ('ready', 'uploaded')
    and fc.embedding is not null
    and fc.embedding_status = 'completed'
    and public.is_active_workspace_member(p_workspace_id)
    and (p_file_ids is null or cardinality(p_file_ids) = 0 or fc.file_id = any(p_file_ids))
  order by fc.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

-- Allow uploaders (not only admins) to remove their own storage objects
drop policy if exists "workspace_files_storage_delete_uploader" on storage.objects;
create policy "workspace_files_storage_delete_uploader"
on storage.objects for delete
using (
  bucket_id = 'workspace-files'
  and exists (
    select 1
    from public.workspace_files wf
    where wf.storage_path = name
      and wf.uploaded_by_user_id = auth.uid()
      and public.is_active_workspace_member(wf.workspace_id)
  )
);
