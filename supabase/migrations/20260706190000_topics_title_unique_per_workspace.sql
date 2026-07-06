-- Fix topics title uniqueness: room_id is only unique per workspace, not globally.
-- Maya DM rooms use a stable id (dm-emp-maya) in every workspace, so the old
-- (room_id, lower(title)) index blocked onboarding for the 2nd+ workspace.

drop index if exists public.topics_room_title_unique;
drop index if exists public.room_topics_room_title_unique;
drop index if exists public.channel_topics_channel_title_unique;

create unique index topics_room_title_unique
  on public.topics (workspace_id, room_id, lower(title))
  where status <> 'archived';
