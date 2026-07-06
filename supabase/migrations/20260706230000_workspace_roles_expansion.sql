-- Commercial Usage System — Phase 4: expand workspace roles.
-- owner | admin | manager | member | guest (migrate legacy viewer -> guest).

-- Migrate existing data first so the new constraint holds.
update public.workspace_members set role = 'guest' where role = 'viewer';
update public.workspace_invitations set role = 'guest' where role = 'viewer';

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'manager', 'member', 'guest'));

-- is_workspace_admin() already checks role in ('owner','admin'); managers are not
-- workspace admins for RLS purposes (they get scoped permissions in the app layer).
