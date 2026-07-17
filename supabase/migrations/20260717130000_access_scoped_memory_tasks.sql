-- Scope memory + tasks (+ work log / approvals by room) to can_access_room_row.
-- Complements private DM RLS so other humans' DM content cannot leak via side tables.

drop policy if exists "memory_entries_all_member" on public.memory_entries;
create policy "memory_entries_select_accessible"
on public.memory_entries for select
using (public.can_access_room_row(workspace_id, room_id));

create policy "memory_entries_insert_accessible"
on public.memory_entries for insert
with check (public.can_access_room_row(workspace_id, room_id));

create policy "memory_entries_update_accessible"
on public.memory_entries for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));

create policy "memory_entries_delete_accessible"
on public.memory_entries for delete
using (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "tasks_all_member" on public.tasks;
create policy "tasks_select_accessible"
on public.tasks for select
using (public.can_access_room_row(workspace_id, room_id));

create policy "tasks_insert_accessible"
on public.tasks for insert
with check (public.can_access_room_row(workspace_id, room_id));

create policy "tasks_update_accessible"
on public.tasks for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));

create policy "tasks_delete_accessible"
on public.tasks for delete
using (public.can_access_room_row(workspace_id, room_id));
