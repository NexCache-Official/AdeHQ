-- Allow workspace owners to permanently delete their workspace (cascades all workspace data).
drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces for delete
using (owner_id = auth.uid());

notify pgrst, 'reload schema';
