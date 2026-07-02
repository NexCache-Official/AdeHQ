-- Allow reusing a topic title after the previous topic was archived or deleted.
drop index if exists public.channel_topics_channel_title_unique;
drop index if exists public.room_topics_room_title_unique;

create unique index room_topics_room_title_unique
  on public.room_topics (room_id, lower(title))
  where status <> 'archived';
