-- Maintenance and trigger functions must not be callable over the public Data API.
-- Trigger execution is unaffected by revoking direct EXECUTE privileges.

revoke execute on function public.delete_unverified_users_older_than(integer)
  from public, anon, authenticated;
revoke execute on function public.ensure_workspace_storage_quota()
  from public, anon, authenticated;
revoke execute on function public.handle_topic_chat_cleared()
  from public, anon, authenticated;
revoke execute on function public.preserve_mailbox_addresses_on_workspace_delete()
  from public, anon, authenticated;
revoke execute on function public.purge_expired_workspace_search_cache()
  from public, anon, authenticated;
revoke execute on function public.purge_topic_workstream_summary(uuid, uuid)
  from public, anon, authenticated;

-- Usage mutation is server-only. Pin search_path even though the function uses
-- fully-qualified table names after replacement.
create or replace function public.increment_workspace_usage_period(
  p_period_id uuid,
  p_work_hours numeric,
  p_cost_usd numeric
) returns void
language sql
set search_path = public, pg_temp
as $$
  update public.workspace_usage_periods
  set ai_work_hours_used = ai_work_hours_used + coalesce(p_work_hours, 0),
      actual_cost_usd = actual_cost_usd + coalesce(p_cost_usd, 0)
  where id = p_period_id;
$$;

revoke execute on function public.increment_workspace_usage_period(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.increment_workspace_usage_period(uuid, numeric, numeric)
  to service_role;
