-- Allow custom plan codes beyond the original five seeded slugs.
-- Commerce identity stays on billing_plans.code; slug format matches Plans hub validation.

alter table public.billing_plans
  drop constraint if exists billing_plans_code_check;

alter table public.billing_plans
  add constraint billing_plans_code_check
  check (code ~ '^[a-z][a-z0-9_]{1,31}$');
