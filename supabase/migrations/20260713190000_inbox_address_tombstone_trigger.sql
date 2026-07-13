-- Preserve inbox addresses when a workspace is deleted (CASCADE would free them).
-- Complements mailbox_address_reservations from 20260712222716_inbox_slice_b.

create or replace function public.preserve_mailbox_addresses_on_workspace_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.mailbox_address_reservations
    (domain, local_part, workspace_id, mailbox_id, reason)
  select
    wm.domain,
    wm.canonical_local_part,
    old.id,
    wm.id,
    'workspace_deleted'
  from public.workspace_mailboxes wm
  where wm.workspace_id = old.id
  on conflict (domain, local_part) do nothing;

  insert into public.mailbox_address_reservations
    (domain, local_part, workspace_id, mailbox_id, reason)
  select
    ma.domain,
    ma.local_part,
    old.id,
    ma.mailbox_id,
    'workspace_deleted_alias'
  from public.mailbox_aliases ma
  where ma.workspace_id = old.id
  on conflict (domain, local_part) do nothing;

  return old;
end;
$$;

drop trigger if exists preserve_mailbox_addresses_on_workspace_delete on public.workspaces;
create trigger preserve_mailbox_addresses_on_workspace_delete
  before delete on public.workspaces
  for each row execute function public.preserve_mailbox_addresses_on_workspace_delete();
