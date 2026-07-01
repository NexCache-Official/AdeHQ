-- V19.4.0: Conversation orchestrator + topic steward persistence

create table if not exists public.conversation_orchestrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  topic_id uuid references public.channel_topics(id) on delete set null,
  trigger_message_id text not null,
  created_by uuid references public.profiles(id) on delete set null,
  intent text not null,
  confidence numeric not null default 0,
  reason text,
  selected_employee_ids text[] not null default '{}',
  lead_employee_id text,
  collaborator_employee_ids text[] not null default '{}',
  response_order jsonb not null default '[]'::jsonb,
  suggested_actions jsonb not null default '[]'::jsonb,
  work_log_required boolean not null default false,
  work_log_reason text,
  status text not null default 'planned'
    check (status in ('planned', 'running', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_orchestrations_lookup_idx
  on public.conversation_orchestrations (workspace_id, room_id, trigger_message_id);

create index if not exists conversation_orchestrations_topic_idx
  on public.conversation_orchestrations (workspace_id, topic_id, created_at desc);

create table if not exists public.topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  topic_id uuid references public.channel_topics(id) on delete set null,
  orchestration_id uuid references public.conversation_orchestrations(id) on delete set null,
  suggested_by_employee_id text,
  trigger_message_id text,
  type text not null,
  title text,
  target_topic_id uuid references public.channel_topics(id) on delete set null,
  reason text,
  confidence numeric not null default 0,
  message_ids text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'dismissed', 'expired')),
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists topic_suggestions_pending_idx
  on public.topic_suggestions (workspace_id, room_id, status, created_at desc)
  where status = 'pending';

drop trigger if exists set_conversation_orchestrations_updated_at on public.conversation_orchestrations;
create trigger set_conversation_orchestrations_updated_at
before update on public.conversation_orchestrations
for each row execute function public.set_updated_at();

alter table public.conversation_orchestrations enable row level security;
alter table public.topic_suggestions enable row level security;

drop policy if exists "conversation_orchestrations_member" on public.conversation_orchestrations;
create policy "conversation_orchestrations_member"
on public.conversation_orchestrations for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "topic_suggestions_member" on public.topic_suggestions;
create policy "topic_suggestions_member"
on public.topic_suggestions for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
