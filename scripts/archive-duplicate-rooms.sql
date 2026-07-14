-- Archive duplicate active project rooms that share a base name
-- (e.g. "Sales Outreach" + "Sales Outreach 2").
-- Keeps the oldest room per (workspace_id, normalized base name).
-- Safe: archives only; does not delete messages or rooms.

with ranked as (
  select
    r.workspace_id,
    r.id as room_id,
    r.name,
    r.created_at,
    lower(trim(regexp_replace(r.name, '\s+\d+$', ''))) as base_name,
    coalesce(
      (select count(*)::int from public.messages m
       where m.workspace_id = r.workspace_id and m.room_id = r.id),
      0
    ) as message_count,
    coalesce(
      (select count(*)::int from public.ai_employees e
       where e.workspace_id = r.workspace_id and e.default_room_id = r.id),
      0
    ) as default_room_refs
  from public.rooms r
  where r.kind = 'room'
    and r.status = 'active'
),
keepers as (
  select distinct on (workspace_id, base_name)
    workspace_id,
    room_id as keep_room_id,
    base_name
  from ranked
  order by
    workspace_id,
    base_name,
    default_room_refs desc,
    message_count desc,
    created_at asc
),
dupes as (
  select r.workspace_id, r.room_id, r.name, k.keep_room_id
  from ranked r
  join keepers k
    on k.workspace_id = r.workspace_id
   and k.base_name = r.base_name
  where r.room_id <> k.keep_room_id
)
update public.rooms rm
set status = 'archived',
    updated_at = now()
from dupes d
where rm.workspace_id = d.workspace_id
  and rm.id = d.room_id
returning rm.workspace_id, rm.id, rm.name, d.keep_room_id;
