-- Harden RLS helpers and privileged table policies.
-- 1) Removed members must not retain Data API access via is_workspace_member.
-- 2) Membership / workspace mutations are admin-only (API uses service role).
-- 3) Agent run + usage writes are service-role only (select stays member/admin).
-- 4) Inbox transport tables are not client-writable.
-- 5) Revoke table privileges on service-only tables.

create or replace function public.is_workspace_member(target_workspace_id uuid)
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
      and coalesce(wm.status, 'active') = 'active'
  );
$$;

create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = target_user_id
    or exists (
      select 1
      from public.workspace_members viewer
      join public.workspace_members target
        on target.workspace_id = viewer.workspace_id
      where viewer.user_id = auth.uid()
        and target.user_id = target_user_id
        and coalesce(viewer.status, 'active') = 'active'
        and coalesce(target.status, 'active') = 'active'
    );
$$;

-- Workspace row updates: admins only (members previously could update any row).
drop policy if exists "workspaces_update_member" on public.workspaces;
drop policy if exists "workspaces_update_admin" on public.workspaces;
create policy "workspaces_update_admin"
on public.workspaces for update
using (public.is_workspace_admin(id) or owner_id = auth.uid())
with check (public.is_workspace_admin(id) or owner_id = auth.uid());

-- Membership mutations: admin only (leave/remove go through API + service role).
drop policy if exists "workspace_members_update_member" on public.workspace_members;
drop policy if exists "workspace_members_update_admin" on public.workspace_members;
create policy "workspace_members_update_admin"
on public.workspace_members for update
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace_members_delete_member" on public.workspace_members;
drop policy if exists "workspace_members_delete_admin" on public.workspace_members;
create policy "workspace_members_delete_admin"
on public.workspace_members for delete
using (public.is_workspace_admin(workspace_id));

-- Agent runs / steps / usage: clients may read; writes are service-role only.
drop policy if exists "agent_runs_insert_member" on public.agent_runs;
drop policy if exists "agent_runs_update_member" on public.agent_runs;
drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;
drop policy if exists "agent_run_steps_update_member" on public.agent_run_steps;
drop policy if exists "ai_usage_events_insert_member" on public.ai_usage_events;
drop policy if exists "ai_usage_events_update_member" on public.ai_usage_events;

-- Inbox transport / suppression: drop client writes (select remains).
do $$
declare
  t text;
begin
  foreach t in array array[
    'email_outbox',
    'email_suppressions',
    'email_events',
    'email_inbound_events'
  ]
  loop
    execute format('drop policy if exists %I_insert_member on public.%I', t, t);
    execute format('drop policy if exists %I_update_member on public.%I', t, t);
    execute format('drop policy if exists %I_delete_member on public.%I', t, t);
  end loop;
end $$;

-- Service-only tables: revoke Direct API grants (RLS-deny is not enough alone).
do $$
declare
  t text;
begin
  foreach t in array array[
    'email_send_log',
    'email_preferences',
    'ai_cost_ledger_entries',
    'workspace_usage_periods',
    'mailbox_address_reservations'
  ]
  loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
