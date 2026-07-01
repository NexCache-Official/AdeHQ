-- Terminology: workspace → rooms → topics (channels become rooms again).

alter table public.channels rename to rooms;
alter table public.channel_members rename to room_members;
alter table public.channel_topics rename to topics;

alter table public.room_members rename column channel_id to room_id;
alter table public.topics rename column channel_id to room_id;
alter table public.messages rename column channel_id to room_id;
alter table public.tasks rename column channel_id to room_id;
alter table public.memory_entries rename column channel_id to room_id;
alter table public.approvals rename column channel_id to room_id;
alter table public.work_log_events rename column channel_id to room_id;
alter table public.calls rename column channel_id to room_id;
alter table public.topic_members rename column channel_id to room_id;
alter table public.message_reactions rename column channel_id to room_id;
alter table public.agent_runs rename column channel_id to room_id;
alter table public.agent_run_steps rename column channel_id to room_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_usage_events' and column_name = 'channel_id'
  ) then
    alter table public.ai_usage_events rename column channel_id to room_id;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_employees' and column_name = 'default_channel_id'
  ) then
    alter table public.ai_employees rename column default_channel_id to default_room_id;
  end if;
end $$;

update public.rooms set kind = 'room' where kind = 'channel';

alter trigger set_channels_updated_at on public.rooms
  rename to set_rooms_updated_at;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'set_channel_topics_updated_at') then
    alter trigger set_channel_topics_updated_at on public.topics
      rename to set_topics_updated_at;
  end if;
end $$;

drop policy if exists "channels_all_member" on public.rooms;
create policy "rooms_all_member"
on public.rooms for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "channel_members_all_member" on public.room_members;
create policy "room_members_all_member"
on public.room_members for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "channel_topics_all_member" on public.topics;
create policy "topics_all_member"
on public.topics for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop index if exists public.channel_topics_channel_title_unique;
create unique index topics_room_title_unique
  on public.topics (room_id, lower(title))
  where status <> 'archived';
