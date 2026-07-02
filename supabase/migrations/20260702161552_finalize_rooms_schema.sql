-- Finalize database terminology: rooms -> topics.
-- This migration is intentionally defensive so it can clean up databases that
-- are still on the intermediate channels/channel_topics naming or already
-- partially renamed.

do $$
begin
  if to_regclass('public.channels') is not null and to_regclass('public.rooms') is null then
    alter table public.channels rename to rooms;
  end if;

  if to_regclass('public.channel_members') is not null and to_regclass('public.room_members') is null then
    alter table public.channel_members rename to room_members;
  end if;

  if to_regclass('public.channel_topics') is not null and to_regclass('public.topics') is null then
    alter table public.channel_topics rename to topics;
  end if;

  if to_regclass('public.room_topics') is not null and to_regclass('public.topics') is null then
    alter table public.room_topics rename to topics;
  end if;
end $$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'room_members',
    'topics',
    'messages',
    'tasks',
    'memory_entries',
    'approvals',
    'work_log_events',
    'calls',
    'topic_members',
    'message_reactions',
    'agent_runs',
    'agent_run_steps',
    'ai_usage_events'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'channel_id'
    ) then
      execute format('alter table public.%I rename column channel_id to room_id', target_table);
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_employees'
      and column_name = 'default_channel_id'
  ) then
    alter table public.ai_employees rename column default_channel_id to default_room_id;
  end if;
end $$;

update public.rooms
set kind = 'room'
where kind = 'channel';

update public.ai_employees
set metadata =
  case
    when metadata ? 'canBeAssignedToChannels' and not metadata ? 'canBeAssignedToRooms'
      then (metadata - 'canBeAssignedToChannels')
        || jsonb_build_object('canBeAssignedToRooms', metadata -> 'canBeAssignedToChannels')
    else metadata - 'canBeAssignedToChannels'
  end
where metadata ? 'canBeAssignedToChannels';

do $$
declare
  item record;
  new_name text;
begin
  for item in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('i', 'I')
      and (
        c.relname like '%channel%'
        or c.relname like '%project_rooms%'
        or c.relname like '%room_topics%'
      )
  loop
    new_name := item.relname;
    new_name := replace(new_name, 'channel_topics', 'topics');
    new_name := replace(new_name, 'room_topics', 'topics');
    new_name := replace(new_name, 'channel_members', 'room_members');
    new_name := replace(new_name, 'channels', 'rooms');
    new_name := replace(new_name, 'project_rooms', 'rooms');
    new_name := replace(new_name, 'channel', 'room');

    if new_name <> item.relname
      and not exists (
        select 1
        from pg_class existing
        join pg_namespace ns on ns.oid = existing.relnamespace
        where ns.nspname = 'public'
          and existing.relname = new_name
      )
    then
      execute format('alter index public.%I rename to %I', item.relname, new_name);
    end if;
  end loop;
end $$;

drop index if exists public.channel_topics_channel_title_unique;
drop index if exists public.room_topics_room_title_unique;
create unique index if not exists topics_room_title_unique
  on public.topics (room_id, lower(title))
  where status <> 'archived';

do $$
declare
  item record;
  new_name text;
begin
  for item in
    select conrelid, conname
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and (
        conname like '%channel%'
        or conname like '%project_rooms%'
        or conname like '%room_topics%'
      )
  loop
    new_name := item.conname;
    new_name := replace(new_name, 'channel_topics', 'topics');
    new_name := replace(new_name, 'room_topics', 'topics');
    new_name := replace(new_name, 'channel_members', 'room_members');
    new_name := replace(new_name, 'channels', 'rooms');
    new_name := replace(new_name, 'project_rooms', 'rooms');
    new_name := replace(new_name, 'channel', 'room');

    if new_name <> item.conname
      and not exists (
        select 1
        from pg_constraint existing
        where existing.conrelid = item.conrelid
          and existing.conname = new_name
      )
    then
      execute format(
        'alter table %s rename constraint %I to %I',
        item.conrelid::regclass,
        item.conname,
        new_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  item record;
  new_name text;
begin
  for item in
    select t.tgrelid, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
      and (
        t.tgname like '%channel%'
        or t.tgname like '%project_rooms%'
        or t.tgname like '%room_topics%'
      )
  loop
    new_name := item.tgname;
    new_name := replace(new_name, 'channel_topics', 'topics');
    new_name := replace(new_name, 'room_topics', 'topics');
    new_name := replace(new_name, 'channels', 'rooms');
    new_name := replace(new_name, 'project_rooms', 'rooms');
    new_name := replace(new_name, 'channel', 'room');

    if new_name <> item.tgname
      and not exists (
        select 1
        from pg_trigger existing
        where existing.tgrelid = item.tgrelid
          and existing.tgname = new_name
      )
    then
      execute format(
        'alter trigger %I on %s rename to %I',
        item.tgname,
        item.tgrelid::regclass,
        new_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  item record;
  new_name text;
begin
  for item in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like '%channel%'
        or policyname like '%project_rooms%'
        or policyname like '%room_topics%'
      )
  loop
    new_name := item.policyname;
    new_name := replace(new_name, 'channel_topics', 'topics');
    new_name := replace(new_name, 'room_topics', 'topics');
    new_name := replace(new_name, 'channel_members', 'room_members');
    new_name := replace(new_name, 'channels', 'rooms');
    new_name := replace(new_name, 'project_rooms', 'rooms');
    new_name := replace(new_name, 'channel', 'room');

    if new_name <> item.policyname
      and not exists (
        select 1
        from pg_policies existing
        where existing.schemaname = item.schemaname
          and existing.tablename = item.tablename
          and existing.policyname = new_name
      )
    then
      execute format(
        'alter policy %I on public.%I rename to %I',
        item.policyname,
        item.tablename,
        new_name
      );
    end if;
  end loop;
end $$;
