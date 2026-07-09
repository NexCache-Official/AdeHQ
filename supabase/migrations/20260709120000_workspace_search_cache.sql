-- Workspace-scoped search answer cache (shared across employees in a workspace).

create table if not exists public.workspace_search_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cache_key text not null,
  query text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  route text not null default 'gateway_perplexity',
  provider_route text not null default 'vercel_gateway',
  search_meta jsonb not null default '{}'::jsonb,
  hit_count integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, cache_key)
);

create index if not exists idx_workspace_search_cache_workspace_expires
  on public.workspace_search_cache (workspace_id, expires_at);

alter table public.workspace_search_cache enable row level security;

drop policy if exists workspace_search_cache_select_member on public.workspace_search_cache;
create policy workspace_search_cache_select_member
  on public.workspace_search_cache
  for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_search_cache_insert_member on public.workspace_search_cache;
create policy workspace_search_cache_insert_member
  on public.workspace_search_cache
  for insert
  with check (public.is_workspace_member(workspace_id));

create or replace function public.purge_expired_workspace_search_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.workspace_search_cache
  where expires_at < now();
end;
$$;
