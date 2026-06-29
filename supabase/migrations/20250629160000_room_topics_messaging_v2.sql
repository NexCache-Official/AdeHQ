-- AdeHQ Messaging v2 — topic-based rooms (Zulip-inspired)
-- room_id is text to match project_rooms.id

-- 1.1 room_topics
create table if not exists public.room_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  title text not null,
  slug text,
  description text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'resolved', 'archived')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  created_by_type text not null default 'human'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text,
  summary text,
  pinned_summary text,
  last_message_at timestamptz,
  last_activity_at timestamptz not null default now(),
  message_count integer not null default 0,
  task_count integer not null default 0,
  open_task_count integer not null default 0,
  memory_count integer not null default 0,
  approval_count integer not null default 0,
  agent_run_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, room_id)
    references public.project_rooms(workspace_id, id) on delete cascade
);

create index if not exists room_topics_workspace_id_idx on public.room_topics(workspace_id);
create index if not exists room_topics_room_id_idx on public.room_topics(room_id);
create index if not exists room_topics_last_activity_idx on public.room_topics(room_id, last_activity_at desc);
create unique index if not exists room_topics_room_title_unique on public.room_topics(room_id, lower(title));

-- 1.2 topic_id on work graph tables
alter table public.messages
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.tasks
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.memory_entries
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.approvals
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.work_log_events
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.agent_runs
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.agent_run_steps
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

alter table public.ai_usage_events
  add column if not exists topic_id uuid references public.room_topics(id) on delete set null;

create index if not exists messages_topic_id_idx on public.messages(topic_id, created_at);
create index if not exists tasks_topic_id_idx on public.tasks(topic_id);
create index if not exists memory_entries_topic_id_idx on public.memory_entries(topic_id);
create index if not exists approvals_topic_id_idx on public.approvals(topic_id);
create index if not exists work_log_events_topic_id_idx on public.work_log_events(topic_id);
create index if not exists agent_runs_topic_id_idx on public.agent_runs(topic_id);
create index if not exists agent_run_steps_topic_id_idx on public.agent_run_steps(topic_id);
create index if not exists ai_usage_events_topic_id_idx on public.ai_usage_events(topic_id);

-- 1.3 topic_members
create table if not exists public.topic_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  topic_id uuid not null references public.room_topics(id) on delete cascade,
  member_type text not null check (member_type in ('human', 'ai')),
  member_id text not null,
  role text not null default 'participant'
    check (role in ('owner', 'participant', 'watcher')),
  notification_level text not null default 'normal'
    check (notification_level in ('muted', 'mentions', 'normal', 'all')),
  last_read_message_id text,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(topic_id, member_type, member_id),
  foreign key (workspace_id, room_id)
    references public.project_rooms(workspace_id, id) on delete cascade
);

create index if not exists topic_members_workspace_idx on public.topic_members(workspace_id);
create index if not exists topic_members_topic_idx on public.topic_members(topic_id);
create index if not exists topic_members_member_idx on public.topic_members(member_type, member_id);

-- 1.4 message_reactions
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  topic_id uuid references public.room_topics(id) on delete cascade,
  message_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique(message_id, user_id, emoji),
  foreign key (workspace_id, message_id)
    references public.messages(workspace_id, id) on delete cascade,
  foreign key (workspace_id, room_id)
    references public.project_rooms(workspace_id, id) on delete cascade
);

create index if not exists message_reactions_message_idx on public.message_reactions(message_id);

-- updated_at trigger for room_topics
drop trigger if exists set_room_topics_updated_at on public.room_topics;
create trigger set_room_topics_updated_at
before update on public.room_topics
for each row execute function public.set_updated_at();

-- Phase 2 — RLS
alter table public.room_topics enable row level security;
alter table public.topic_members enable row level security;
alter table public.message_reactions enable row level security;

drop policy if exists "room_topics_select_member" on public.room_topics;
create policy "room_topics_select_member"
on public.room_topics for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "room_topics_insert_member" on public.room_topics;
create policy "room_topics_insert_member"
on public.room_topics for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "room_topics_update_member" on public.room_topics;
create policy "room_topics_update_member"
on public.room_topics for update
using (
  public.is_workspace_admin(workspace_id)
  or created_by_id = auth.uid()::text
  or public.is_workspace_member(workspace_id)
)
with check (public.is_workspace_member(workspace_id));

drop policy if exists "room_topics_delete_admin" on public.room_topics;
create policy "room_topics_delete_admin"
on public.room_topics for delete
using (public.is_workspace_admin(workspace_id));

drop policy if exists "topic_members_all_member" on public.topic_members;
create policy "topic_members_all_member"
on public.topic_members for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "message_reactions_all_member" on public.message_reactions;
create policy "message_reactions_all_member"
on public.message_reactions for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- Phase 4 — Backfill General topics
insert into public.room_topics (workspace_id, room_id, title, description, created_by_type)
select r.workspace_id, r.id, 'General', 'Default topic for existing room messages.', 'system'
from public.project_rooms r
where not exists (
  select 1 from public.room_topics t
  where t.room_id = r.id and lower(t.title) = 'general'
);

update public.messages m
set topic_id = t.id
from public.room_topics t
where m.room_id = t.room_id
  and lower(t.title) = 'general'
  and m.topic_id is null;

update public.tasks tk
set topic_id = t.id
from public.room_topics t
where tk.room_id = t.room_id
  and lower(t.title) = 'general'
  and tk.topic_id is null;

update public.memory_entries me
set topic_id = t.id
from public.room_topics t
where me.room_id = t.room_id
  and lower(t.title) = 'general'
  and me.topic_id is null;

update public.approvals a
set topic_id = t.id
from public.room_topics t
where a.room_id = t.room_id
  and lower(t.title) = 'general'
  and a.topic_id is null;

update public.work_log_events w
set topic_id = t.id
from public.room_topics t
where w.room_id = t.room_id
  and lower(t.title) = 'general'
  and w.topic_id is null;

update public.agent_runs ar
set topic_id = t.id
from public.room_topics t
where ar.room_id = t.room_id
  and lower(t.title) = 'general'
  and ar.topic_id is null;

update public.agent_run_steps ars
set topic_id = t.id
from public.room_topics t
where ars.room_id = t.room_id
  and lower(t.title) = 'general'
  and ars.topic_id is null;

update public.ai_usage_events aue
set topic_id = t.id
from public.room_topics t
where aue.room_id = t.room_id
  and lower(t.title) = 'general'
  and aue.topic_id is null;

-- Refresh topic counters for General topics
update public.room_topics rt
set
  message_count = coalesce((
    select count(*)::integer from public.messages m where m.topic_id = rt.id
  ), 0),
  task_count = coalesce((
    select count(*)::integer from public.tasks tk where tk.topic_id = rt.id
  ), 0),
  open_task_count = coalesce((
    select count(*)::integer from public.tasks tk
    where tk.topic_id = rt.id and tk.status in ('open', 'in_progress', 'waiting_approval', 'blocked')
  ), 0),
  memory_count = coalesce((
    select count(*)::integer from public.memory_entries me where me.topic_id = rt.id
  ), 0),
  approval_count = coalesce((
    select count(*)::integer from public.approvals a
    where a.topic_id = rt.id and a.status = 'pending'
  ), 0),
  agent_run_count = coalesce((
    select count(*)::integer from public.agent_runs ar where ar.topic_id = rt.id
  ), 0),
  last_message_at = (
    select max(m.created_at) from public.messages m where m.topic_id = rt.id
  ),
  last_activity_at = coalesce(
    (select max(m.created_at) from public.messages m where m.topic_id = rt.id),
    rt.last_activity_at
  );

notify pgrst, 'reload schema';
