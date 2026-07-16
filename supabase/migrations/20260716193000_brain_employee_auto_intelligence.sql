-- AdeHQ Brain PR-5: migrate employees to Auto intelligence while preserving tier bias.

-- Store preferred intensity floor on intelligence_policy jsonb when present.
-- employees.intelligence_policy column shape varies; we patch jsonb safely.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_employees'
      and column_name = 'intelligence_policy'
  ) then
    update public.ai_employees
    set intelligence_policy =
      coalesce(intelligence_policy, '{}'::jsonb)
      || jsonb_build_object(
        'preferredIntensityFloor',
        case
          when coalesce(intelligence_policy->>'defaultMode', model_mode) in ('cheap', 'efficient') then 'fast'
          when coalesce(intelligence_policy->>'defaultMode', model_mode) in ('strong') then 'deep'
          else 'standard'
        end
      )
      || jsonb_build_object('defaultMode', 'auto')
    where coalesce(intelligence_policy->>'defaultMode', '') <> 'auto';
  end if;
end $$;
