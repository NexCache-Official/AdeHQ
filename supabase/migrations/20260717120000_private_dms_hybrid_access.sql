-- Private DMs + layered hybrid-workforce access foundation.
-- Identity columns, room visibility, AI grants, topic deny overrides,
-- ownership backfill, tighter RLS for DMs.

-- ---------------------------------------------------------------------------
-- Columns: workspaces / members access versions
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists access_version bigint not null default 1;

alter table public.workspace_members
  add column if not exists access_version bigint not null default 1;

alter table public.workspace_members
  add column if not exists display_title text,
  add column if not exists bio text,
  add column if not exists timezone text,
  add column if not exists availability_status text;

-- ---------------------------------------------------------------------------
-- AI employees: kind + access level
-- ---------------------------------------------------------------------------
alter table public.ai_employees
  add column if not exists employee_kind text not null default 'workspace_employee',
  add column if not exists employee_access text not null default 'workspace';

update public.ai_employees
set employee_kind = 'system_manager',
    employee_access = 'restricted'
where coalesce(is_system_employee, false) = true
   or system_employee_key = 'maya';

alter table public.ai_employees
  drop constraint if exists ai_employees_employee_kind_check;
alter table public.ai_employees
  add constraint ai_employees_employee_kind_check
  check (employee_kind in ('workspace_employee', 'system_manager'));

alter table public.ai_employees
  drop constraint if exists ai_employees_employee_access_check;
alter table public.ai_employees
  add constraint ai_employees_employee_access_check
  check (employee_access in ('workspace', 'department', 'restricted'));

-- ---------------------------------------------------------------------------
-- Rooms: visibility + DM identity
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column if not exists room_visibility text,
  add column if not exists dm_owner_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists dm_peer_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists dm_pair_key text;

-- Default group rooms to workspace-visible
update public.rooms
set room_visibility = 'workspace'
where kind <> 'dm'
  and room_visibility is null;

alter table public.rooms
  drop constraint if exists rooms_room_visibility_check;
alter table public.rooms
  add constraint rooms_room_visibility_check
  check (
    room_visibility is null
    or room_visibility in ('workspace', 'restricted', 'private')
  );

-- Drop old kind shape before backfill (re-add after ownership is set)
alter table public.rooms drop constraint if exists rooms_kind_shape;

-- ---------------------------------------------------------------------------
-- Ownership migration report + backfill shared AI DMs
-- ---------------------------------------------------------------------------
create table if not exists public.dm_ownership_migration_report (
  workspace_id uuid not null,
  room_id text not null,
  selected_owner uuid,
  selection_reason text not null,
  message_count integer not null default 0,
  fallback_used boolean not null default false,
  migrated_at timestamptz not null default now(),
  primary key (workspace_id, room_id)
);

do $$
declare
  r record;
  owner_id uuid;
  reason text;
  msg_count integer;
  fallback boolean;
begin
  for r in
    select *
    from public.rooms
    where kind = 'dm'
      and dm_employee_id is not null
      and dm_owner_user_id is null
  loop
    owner_id := null;
    reason := 'workspace_admin_fallback';
    msg_count := 0;
    fallback := true;

    -- Highest human sender
    select s.sender_uuid, s.cnt
    into owner_id, msg_count
    from (
      select m.sender_id::uuid as sender_uuid, count(*)::int as cnt
      from public.messages m
      where m.workspace_id = r.workspace_id
        and m.room_id = r.id
        and m.sender_type = 'human'
      group by m.sender_id
      order by count(*) desc, min(m.created_at) asc
      limit 1
    ) s;

    if owner_id is not null and msg_count > 0 then
      reason := 'highest_human_sender';
      fallback := false;
    else
      -- Earliest human room member
      select rm.member_id::uuid
      into owner_id
      from public.room_members rm
      where rm.workspace_id = r.workspace_id
        and rm.room_id = r.id
        and rm.member_type = 'human'
      order by rm.created_at asc
      limit 1;

      if owner_id is not null then
        reason := 'earliest_human_member';
        msg_count := 0;
        fallback := true;
      else
        select wm.user_id
        into owner_id
        from public.workspace_members wm
        where wm.workspace_id = r.workspace_id
          and coalesce(wm.status, 'active') = 'active'
          and wm.role in ('admin', 'owner')
        order by wm.joined_at asc nulls last
        limit 1;
        reason := 'workspace_admin_fallback';
        fallback := true;
        msg_count := 0;
      end if;
    end if;

    if owner_id is null then
      continue;
    end if;

    update public.rooms
    set dm_owner_user_id = owner_id,
        dm_peer_user_id = null,
        dm_pair_key = null,
        room_visibility = null,
        updated_at = now()
    where workspace_id = r.workspace_id
      and id = r.id;

    -- Strip unrelated human members (projection for owner + AI only)
    delete from public.room_members rm
    where rm.workspace_id = r.workspace_id
      and rm.room_id = r.id
      and rm.member_type = 'human'
      and rm.member_id <> owner_id::text;

    insert into public.room_members (workspace_id, room_id, member_type, member_id)
    values (r.workspace_id, r.id, 'human', owner_id::text)
    on conflict do nothing;

    insert into public.dm_ownership_migration_report (
      workspace_id, room_id, selected_owner, selection_reason, message_count, fallback_used
    ) values (
      r.workspace_id, r.id, owner_id, reason, coalesce(msg_count, 0), fallback
    )
    on conflict (workspace_id, room_id) do update
      set selected_owner = excluded.selected_owner,
          selection_reason = excluded.selection_reason,
          message_count = excluded.message_count,
          fallback_used = excluded.fallback_used,
          migrated_at = now();
  end loop;
end $$;

-- Delete orphan AI DMs that could not be assigned an owner (no humans/admins)
delete from public.rooms r
where r.kind = 'dm'
  and r.dm_employee_id is not null
  and r.dm_owner_user_id is null;

-- Enforce identity shape after backfill
alter table public.rooms
  add constraint rooms_kind_shape check (
    (
      kind = 'dm'
      and dm_owner_user_id is not null
      and (
        (dm_employee_id is not null and dm_peer_user_id is null and dm_pair_key is null)
        or (dm_employee_id is null and dm_peer_user_id is not null and dm_pair_key is not null)
      )
    )
    or (
      kind <> 'dm'
      and dm_employee_id is null
      and dm_owner_user_id is null
      and dm_peer_user_id is null
      and dm_pair_key is null
      and room_visibility is not null
    )
  );

-- Unique indexes for private DM identity
create unique index if not exists rooms_ai_dm_unique
  on public.rooms (workspace_id, dm_owner_user_id, dm_employee_id)
  where kind = 'dm' and dm_employee_id is not null;

create unique index if not exists rooms_human_dm_unique
  on public.rooms (workspace_id, dm_pair_key)
  where kind = 'dm' and dm_pair_key is not null;

create index if not exists rooms_dm_owner_idx
  on public.rooms (workspace_id, dm_owner_user_id)
  where kind = 'dm';

-- ---------------------------------------------------------------------------
-- Grants + topic overrides + room_user_state + invite package tables
-- ---------------------------------------------------------------------------
create table if not exists public.ai_employee_user_grants (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id text not null,
  access_effect text not null check (access_effect in ('allow', 'deny')),
  can_dm boolean not null default true,
  can_assign_work boolean not null default true,
  can_view_shared_outputs boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (workspace_id, user_id, employee_id),
  foreign key (workspace_id, employee_id)
    references public.ai_employees(workspace_id, id)
    on delete cascade
);

create table if not exists public.topic_access_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access text not null default 'denied' check (access = 'denied'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, topic_id, user_id)
);

create table if not exists public.room_user_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_message_id text,
  last_read_at timestamptz,
  muted boolean not null default false,
  archived boolean not null default false,
  pinned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, room_id, user_id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

alter table public.workspace_invitations
  add column if not exists access_preset text not null default 'full_member',
  add column if not exists access_package jsonb not null default '{}'::jsonb;

create table if not exists public.invite_ai_employee_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  employee_id text not null,
  access_effect text not null default 'allow' check (access_effect in ('allow', 'deny')),
  can_dm boolean not null default true,
  can_assign_work boolean not null default true,
  can_view_shared_outputs boolean not null default true,
  primary key (invite_id, employee_id)
);

create table if not exists public.invite_room_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  room_id text not null,
  primary key (invite_id, room_id)
);

create table if not exists public.invite_topic_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  topic_id text not null,
  access text not null default 'denied' check (access = 'denied'),
  primary key (invite_id, topic_id)
);

create table if not exists public.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helper + RLS
-- ---------------------------------------------------------------------------
create or replace function public.bump_workspace_access_version(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspaces
  set access_version = access_version + 1
  where id = target_workspace_id;
end;
$$;

create or replace function public.bump_member_access_version(
  target_workspace_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_members
  set access_version = access_version + 1
  where workspace_id = target_workspace_id
    and user_id = target_user_id;
  perform public.bump_workspace_access_version(target_workspace_id);
end;
$$;

create or replace function public.can_access_room_row(
  p_workspace_id uuid,
  p_room_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    where r.workspace_id = p_workspace_id
      and r.id = p_room_id
      and public.is_workspace_member(r.workspace_id)
      and (
        (
          r.kind = 'dm'
          and (
            r.dm_owner_user_id = auth.uid()
            or r.dm_peer_user_id = auth.uid()
          )
        )
        or (
          r.kind <> 'dm'
          and coalesce(r.room_visibility, 'workspace') = 'workspace'
        )
        or (
          r.kind <> 'dm'
          and coalesce(r.room_visibility, 'workspace') in ('restricted', 'private')
          and exists (
            select 1
            from public.room_members rm
            where rm.workspace_id = r.workspace_id
              and rm.room_id = r.id
              and rm.member_type = 'human'
              and rm.member_id = auth.uid()::text
          )
        )
      )
  );
$$;

grant execute on function public.can_access_room_row(uuid, text) to authenticated;
grant execute on function public.bump_workspace_access_version(uuid) to service_role;
grant execute on function public.bump_member_access_version(uuid, uuid) to service_role;

drop policy if exists "rooms_all_member" on public.rooms;
create policy "rooms_select_accessible"
on public.rooms for select
using (public.can_access_room_row(workspace_id, id));

create policy "rooms_insert_member"
on public.rooms for insert
with check (public.is_workspace_member(workspace_id));

create policy "rooms_update_accessible"
on public.rooms for update
using (public.can_access_room_row(workspace_id, id))
with check (public.can_access_room_row(workspace_id, id));

create policy "rooms_delete_admin"
on public.rooms for delete
using (public.is_workspace_admin(workspace_id));

drop policy if exists "messages_all_member" on public.messages;
create policy "messages_select_accessible"
on public.messages for select
using (public.can_access_room_row(workspace_id, room_id));

create policy "messages_insert_accessible"
on public.messages for insert
with check (public.can_access_room_row(workspace_id, room_id));

create policy "messages_update_accessible"
on public.messages for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));

create policy "messages_delete_accessible"
on public.messages for delete
using (public.can_access_room_row(workspace_id, room_id));

alter table public.ai_employee_user_grants enable row level security;
alter table public.topic_access_overrides enable row level security;
alter table public.room_user_state enable row level security;
alter table public.invite_ai_employee_grants enable row level security;
alter table public.invite_room_grants enable row level security;
alter table public.invite_topic_grants enable row level security;
alter table public.access_audit_events enable row level security;
alter table public.dm_ownership_migration_report enable row level security;

create policy "ai_grants_select_own_or_admin"
on public.ai_employee_user_grants for select
using (
  public.is_workspace_member(workspace_id)
  and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
);

create policy "ai_grants_admin_write"
on public.ai_employee_user_grants for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

create policy "topic_overrides_select_own_or_admin"
on public.topic_access_overrides for select
using (
  public.is_workspace_member(workspace_id)
  and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
);

create policy "topic_overrides_admin_write"
on public.topic_access_overrides for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

create policy "room_user_state_own"
on public.room_user_state for all
using (public.is_workspace_member(workspace_id) and user_id = auth.uid())
with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());

create policy "access_audit_admin_select"
on public.access_audit_events for select
using (public.is_workspace_admin(workspace_id));

create policy "dm_migration_report_admin"
on public.dm_ownership_migration_report for select
using (public.is_workspace_admin(workspace_id));

-- Invite grant tables: admin only (accept uses service role)
create policy "invite_ai_grants_admin"
on public.invite_ai_employee_grants for all
using (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
);

create policy "invite_room_grants_admin"
on public.invite_room_grants for all
using (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
);

create policy "invite_topic_grants_admin"
on public.invite_topic_grants for all
using (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.workspace_invitations i
    where i.id = invite_id and public.is_workspace_admin(i.workspace_id)
  )
);
