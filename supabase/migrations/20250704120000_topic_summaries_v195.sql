-- V19.5.0: Durable topic workstream summaries

create table if not exists public.topic_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  topic_id uuid not null references public.channel_topics(id) on delete cascade,
  summary text,
  what_happened text,
  current_decision text,
  open_questions jsonb not null default '[]'::jsonb,
  key_facts jsonb not null default '[]'::jsonb,
  next_actions jsonb not null default '[]'::jsonb,
  suggested_memory jsonb not null default '[]'::jsonb,
  source_message_ids text[] not null default '{}',
  source_work_log_ids text[] not null default '{}',
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, topic_id)
);

create index if not exists topic_summaries_topic_idx
  on public.topic_summaries (workspace_id, topic_id);

drop trigger if exists set_topic_summaries_updated_at on public.topic_summaries;
create trigger set_topic_summaries_updated_at
before update on public.topic_summaries
for each row execute function public.set_updated_at();

alter table public.topic_summaries enable row level security;

drop policy if exists "topic_summaries_member" on public.topic_summaries;
create policy "topic_summaries_member"
on public.topic_summaries for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
