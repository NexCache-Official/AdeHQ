-- Free inbox addresses when a workspace is deleted.
-- Previously we tombstoned addresses into mailbox_address_reservations so they
-- could never be reclaimed. Product decision: deleting a workspace (or account)
-- releases the address and clears inbox residue so others can claim it.

-- 1) Stop preserving addresses on workspace delete
drop trigger if exists preserve_mailbox_addresses_on_workspace_delete on public.workspaces;
drop function if exists public.preserve_mailbox_addresses_on_workspace_delete();

-- 2) Release every historical tombstone (trigger was the only writer)
truncate table public.mailbox_address_reservations;

-- 3) Clear orphan inbound webhook rows that never resolved to a workspace
--    (inserted without workspace_id; survive forever and can block re-ingest).
delete from public.email_inbound_events
where workspace_id is null;
