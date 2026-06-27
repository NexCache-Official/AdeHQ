-- AdeHQ production schema alignment
-- Run this in Supabase → SQL Editor if your project was created before workspace_mode was added.
-- Safe to run multiple times (idempotent).

-- workspaces: columns added in Phase 1
alter table public.workspaces add column if not exists slug text;

alter table public.workspaces add column if not exists workspace_mode text;

update public.workspaces
set workspace_mode = 'real'
where workspace_mode is null;

alter table public.workspaces
  alter column workspace_mode set default 'real';

alter table public.workspaces
  alter column workspace_mode set not null;

alter table public.workspaces drop constraint if exists workspaces_workspace_mode_check;

alter table public.workspaces
  add constraint workspaces_workspace_mode_check
  check (workspace_mode in ('real', 'demo'));

-- workspace_members: membership status + joined_at
alter table public.workspace_members add column if not exists status text;

update public.workspace_members
set status = 'active'
where status is null;

alter table public.workspace_members
  alter column status set default 'active';

alter table public.workspace_members
  alter column status set not null;

alter table public.workspace_members add column if not exists joined_at timestamptz;

update public.workspace_members wm
set joined_at = coalesce(wm.joined_at, wm.created_at, now())
where joined_at is null;

alter table public.workspace_members
  alter column joined_at set default now();

alter table public.workspace_members
  alter column joined_at set not null;

alter table public.workspace_members drop constraint if exists workspace_members_status_check;

alter table public.workspace_members
  add constraint workspace_members_status_check
  check (status in ('active', 'removed'));

-- model provider configs (BYOK placeholder table)
create table if not exists public.model_provider_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (
    provider in ('openai', 'anthropic', 'gemini', 'perplexity', 'openrouter', 'siliconflow', 'mock')
  ),
  encrypted_api_key text,
  vault_secret_id text,
  default_model text,
  status text not null default 'not_configured',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

alter table public.model_provider_configs enable row level security;

drop policy if exists "model_provider_configs_admin" on public.model_provider_configs;
create policy "model_provider_configs_admin"
on public.model_provider_configs for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "model_provider_configs_select_member" on public.model_provider_configs;
create policy "model_provider_configs_select_member"
on public.model_provider_configs for select
using (public.is_workspace_member(workspace_id));

drop trigger if exists set_model_provider_configs_updated_at on public.model_provider_configs;
create trigger set_model_provider_configs_updated_at
before update on public.model_provider_configs
for each row execute function public.set_updated_at();

-- Refresh PostgREST schema cache so API sees new columns immediately
notify pgrst, 'reload schema';
