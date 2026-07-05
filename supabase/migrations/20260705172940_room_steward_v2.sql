-- V19.9.3: Room Orchestration Steward V2 active thread state

create table if not exists public.topic_orchestration_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null,
  room_id text not null,
  active_employee_ids text[] not null default '{}',
  last_human_message_id text,
  last_ai_message_id text,
  pending_questions jsonb not null default '[]'::jsonb,
  current_work_intent text not null default 'unknown'
    check (
      current_work_intent in (
        'launch_pitch',
        'market_research',
        'sales_pitch',
        'hiring',
        'artifact_creation',
        'general_discussion',
        'unknown'
      )
    ),
  last_decision text,
  last_project_entity text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, topic_id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

do $$
begin
  if to_regclass('public.topics') is not null then
    alter table public.topic_orchestration_state
      add constraint topic_orchestration_state_topic_fk
      foreign key (topic_id)
      references public.topics(id)
      on delete cascade;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists topic_orchestration_state_room_idx
  on public.topic_orchestration_state(workspace_id, room_id, updated_at desc);

drop trigger if exists set_topic_orchestration_state_updated_at
  on public.topic_orchestration_state;
create trigger set_topic_orchestration_state_updated_at
before update on public.topic_orchestration_state
for each row execute function public.set_updated_at();

alter table public.topic_orchestration_state enable row level security;

drop policy if exists "topic_orchestration_state_member"
  on public.topic_orchestration_state;
create policy "topic_orchestration_state_member"
on public.topic_orchestration_state for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

comment on table public.topic_orchestration_state is
  'Short-lived private Room Steward state for active AI thread continuation.';

comment on column public.topic_orchestration_state.pending_questions is
  'Open, answered, and expired AI employee questions tracked by the Room Steward.';
