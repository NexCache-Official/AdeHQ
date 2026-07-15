-- Collapse workspace roles to admin | member.
-- owner → admin; manager | guest | viewer → member.

update public.workspace_members
set role = 'admin'
where role = 'owner';

update public.workspace_members
set role = 'member'
where role in ('manager', 'guest', 'viewer');

update public.workspace_invitations
set role = 'admin'
where role = 'owner';

update public.workspace_invitations
set role = 'member'
where role in ('manager', 'guest', 'viewer');

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('admin', 'member'));

alter table public.workspace_invitations drop constraint if exists workspace_invitations_role_check;
alter table public.workspace_invitations
  add constraint workspace_invitations_role_check
  check (role in ('admin', 'member'));

-- Admin-only helper (was owner|admin).
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status is distinct from 'removed'
      and wm.role = 'admin'
  );
$$;

comment on function public.is_workspace_admin(uuid) is
  'True when the auth user is an active admin of the workspace.';
