-- Unify terminology: Channel = group room or DM (stored in `channels`).
-- Rename legacy project_rooms / room_* tables and room_id columns to channel_*.

-- Channel lifecycle (archive group channels)
alter table public.project_rooms
  add column if not exists status text not null default 'active'
  check (status in ('active', 'archived'));

-- Core tables
alter table public.project_rooms rename to channels;
alter table public.room_members rename to channel_members;
alter table public.room_topics rename to channel_topics;

-- Foreign-key columns
alter table public.channel_members rename column room_id to channel_id;
alter table public.channel_topics rename column room_id to channel_id;
alter table public.messages rename column room_id to channel_id;
alter table public.tasks rename column room_id to channel_id;
alter table public.memory_entries rename column room_id to channel_id;
alter table public.approvals rename column room_id to channel_id;
alter table public.work_log_events rename column room_id to channel_id;
alter table public.calls rename column room_id to channel_id;
alter table public.topic_members rename column room_id to channel_id;
alter table public.message_reactions rename column room_id to channel_id;
alter table public.agent_runs rename column room_id to channel_id;
alter table public.agent_run_steps rename column room_id to channel_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_usage_events' and column_name = 'room_id'
  ) then
    alter table public.ai_usage_events rename column room_id to channel_id;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_employees' and column_name = 'default_room_id'
  ) then
    alter table public.ai_employees rename column default_room_id to default_channel_id;
  end if;
end $$;

-- Triggers
alter trigger set_project_rooms_updated_at on public.channels
  rename to set_channels_updated_at;

do $$
begin
  if exists (
    select 1 from pg_trigger where tgname = 'set_room_topics_updated_at'
  ) then
    alter trigger set_room_topics_updated_at on public.channel_topics
      rename to set_channel_topics_updated_at;
  end if;
end $$;

-- RLS policies (cosmetic rename for clarity)
drop policy if exists "project_rooms_all_member" on public.channels;
create policy "channels_all_member"
on public.channels for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "room_members_all_member" on public.channel_members;
create policy "channel_members_all_member"
on public.channel_members for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "room_topics_all_member" on public.channel_topics;
create policy "channel_topics_all_member"
on public.channel_topics for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
