-- AdeHQ unverified user cleanup
-- Deletes Auth users who haven't confirmed their email within 20 minutes.
-- This keeps signup UX predictable when Supabase confirmation tokens expire.

create extension if not exists pg_cron;

create or replace function public.delete_unverified_users_older_than(p_seconds integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted integer;
begin
  if p_seconds is null or p_seconds <= 0 then
    return 0;
  end if;

  with del as (
    delete from auth.users u
    where u.email_confirmed_at is null
      and u.created_at < now() - (p_seconds || ' seconds')::interval
      and coalesce(u.is_sso_user, false) = false
    returning 1
  )
  select count(*) into v_deleted from del;

  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.delete_unverified_users_older_than(integer) from public;

do $$
begin
  -- Idempotent schedule update
  if exists (select 1 from cron.job where jobname = 'delete_unverified_users_20m') then
    perform cron.unschedule('delete_unverified_users_20m');
  end if;

  perform cron.schedule(
    'delete_unverified_users_20m',
    '*/5 * * * *',
    $$select public.delete_unverified_users_older_than(1200);$$
  );
end $$;

