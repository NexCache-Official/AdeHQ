-- V20.0.5 — conversation context epochs for clear-chat hardening

create table if not exists public.conversation_context_epochs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope_type text not null check (scope_type in ('room', 'topic', 'dm')),
  scope_id text not null,
  sequence integer not null default 1,
  started_at timestamptz not null default now(),
  cleared_at timestamptz null,
  cleared_by uuid null,
  clear_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_context_epochs_scope_idx
  on public.conversation_context_epochs (workspace_id, scope_type, scope_id, sequence desc);

alter table public.topics
  add column if not exists current_context_epoch_id uuid null,
  add column if not exists chat_cleared_at timestamptz null;

create index if not exists topics_chat_cleared_at_idx
  on public.topics (workspace_id, chat_cleared_at)
  where chat_cleared_at is not null;

alter table public.conversation_context_epochs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'conversation_context_epochs'
      and policyname = 'conversation_context_epochs_workspace_member'
  ) then
    create policy conversation_context_epochs_workspace_member
      on public.conversation_context_epochs
      for all
      using (
        workspace_id in (
          select wm.workspace_id
          from public.workspace_members wm
          where wm.user_id = auth.uid()
        )
      )
      with check (
        workspace_id in (
          select wm.workspace_id
          from public.workspace_members wm
          where wm.user_id = auth.uid()
        )
      );
  end if;
end $$;
