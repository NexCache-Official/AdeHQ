-- V19.1.3: Maya always online + backfill DM main chat topics

update public.ai_employees
set status = 'online',
    updated_at = now()
where system_employee_key = 'maya_recruiting_manager';

insert into public.room_topics (
  workspace_id,
  room_id,
  title,
  description,
  created_by_type,
  metadata
)
select
  r.workspace_id,
  r.id,
  'General',
  'Default topic for existing room messages.',
  'system',
  '{"isMainChat": true, "aiParticipationMode": "smart_assist_lite"}'::jsonb
from public.project_rooms r
where r.kind = 'dm'
  and r.dm_employee_id = 'emp-maya'
  and not exists (
    select 1
    from public.room_topics t
    where t.workspace_id = r.workspace_id
      and t.room_id = r.id
      and lower(t.title) = 'general'
  );

insert into public.topic_members (
  workspace_id,
  room_id,
  topic_id,
  member_type,
  member_id,
  role
)
select
  rm.workspace_id,
  rm.room_id,
  t.id,
  rm.member_type,
  rm.member_id,
  case when rm.member_type = 'human' then 'owner' else 'participant' end
from public.room_members rm
join public.project_rooms r
  on r.workspace_id = rm.workspace_id
 and r.id = rm.room_id
join public.room_topics t
  on t.workspace_id = rm.workspace_id
 and t.room_id = rm.room_id
 and lower(t.title) = 'general'
where r.kind = 'dm'
  and r.dm_employee_id = 'emp-maya'
  and not exists (
    select 1
    from public.topic_members tm
    where tm.topic_id = t.id
      and tm.member_type = rm.member_type
      and tm.member_id = rm.member_id
  );

update public.messages m
set topic_id = t.id
from public.project_rooms r
join public.room_topics t
  on t.workspace_id = r.workspace_id
 and t.room_id = r.id
 and lower(t.title) = 'general'
where m.workspace_id = r.workspace_id
  and m.room_id = r.id
  and m.topic_id is null
  and r.kind = 'dm'
  and r.dm_employee_id = 'emp-maya';
