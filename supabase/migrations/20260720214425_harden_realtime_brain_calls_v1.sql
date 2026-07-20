-- Live call sessions, transcripts, turns, and usage are server-authored.
-- Members may read only rows for conversations they can access.

drop policy if exists "calls_scoped_member" on public.calls;
create policy "calls_scoped_member_select"
on public.calls for select
using (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "call_transcripts_scoped_member" on public.call_transcripts;
create policy "call_transcripts_scoped_member_select"
on public.call_transcripts for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_transcripts.workspace_id
      and c.id = call_transcripts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

drop policy if exists "call_turns_scoped_member" on public.call_turns;
create policy "call_turns_scoped_member_select"
on public.call_turns for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_turns.workspace_id
      and c.id = call_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

revoke insert, update, delete on public.calls from anon, authenticated;
revoke insert, update, delete on public.call_transcripts from anon, authenticated;
revoke insert, update, delete on public.call_turns from anon, authenticated;
revoke insert, update, delete on public.call_usage_settlements from anon, authenticated;
