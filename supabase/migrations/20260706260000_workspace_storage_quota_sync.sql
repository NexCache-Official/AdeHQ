-- Sync workspace_storage_quotas with commercial plan entitlements.

alter table public.workspace_storage_quotas
  drop constraint if exists workspace_storage_quotas_plan_tier_check;

alter table public.workspace_storage_quotas
  add constraint workspace_storage_quotas_plan_tier_check
  check (plan_tier in ('free', 'pro', 'team', 'business', 'enterprise'));

create or replace function public.ensure_workspace_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_slug text;
  v_max_storage bigint;
  v_max_file_mb int;
begin
  v_plan_slug := coalesce(new.plan_slug, 'free');

  select max_storage_bytes, max_file_upload_mb
  into v_max_storage, v_max_file_mb
  from public.platform_plan_configs
  where plan_slug = v_plan_slug;

  insert into public.workspace_storage_quotas (
    workspace_id,
    plan_tier,
    max_workspace_bytes,
    max_file_bytes
  ) values (
    new.id,
    v_plan_slug,
    coalesce(nullif(v_max_storage, 0), 1099511627776),
    coalesce(v_max_file_mb, 10) * 1024 * 1024
  )
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

drop trigger if exists ensure_workspace_storage_quota_on_workspace on public.workspaces;
create trigger ensure_workspace_storage_quota_on_workspace
  after insert on public.workspaces
  for each row execute function public.ensure_workspace_storage_quota();

update public.workspace_storage_quotas q
set
  plan_tier = coalesce(w.plan_slug, 'free'),
  max_workspace_bytes = coalesce(nullif(p.max_storage_bytes, 0), 1099511627776),
  max_file_bytes = coalesce(p.max_file_upload_mb, 10) * 1024 * 1024,
  updated_at = now()
from public.workspaces w
join public.platform_plan_configs p on p.plan_slug = coalesce(w.plan_slug, 'free')
where q.workspace_id = w.id;
