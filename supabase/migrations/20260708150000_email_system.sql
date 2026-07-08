-- AdeHQ Email System v1
-- Delivery log for every transactional email + per-user preference/opt-out
-- registry for preference-gated categories. Always-on categories
-- (auth/security/billing) are never represented in email_preferences.
-- Both tables are platform/service-role only (no customer-facing RLS policies);
-- writes happen exclusively through src/lib/email/send.ts with the secret key.

create table if not exists public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  template text not null,
  category text not null,
  recipient text not null,
  subject text not null,
  status text not null check (status in (
    'sent', 'failed', 'skipped_unsubscribed', 'test_redirected'
  )),
  provider text not null default 'resend',
  provider_message_id text null,
  error text null,
  workspace_id uuid null references public.workspaces(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_email_send_log_recipient
  on public.email_send_log (recipient, created_at desc);
create index if not exists idx_email_send_log_template
  on public.email_send_log (template, created_at desc);
create index if not exists idx_email_send_log_created_at
  on public.email_send_log (created_at desc);

create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  product_updates boolean not null default true,
  weekly_reports boolean not null default true,
  activity_notifications boolean not null default true,
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_preferences_email
  on public.email_preferences (email);

drop trigger if exists set_email_preferences_updated_at on public.email_preferences;
create trigger set_email_preferences_updated_at
before update on public.email_preferences
for each row execute function public.set_updated_at();

alter table public.email_send_log enable row level security;
alter table public.email_preferences enable row level security;

-- Preference-gated sends read/create the row by service-role only; the
-- unsubscribe route and settings API also go through the service-role client.
-- Platform admins read email_send_log through admin queries (service-role),
-- so no customer-facing policies are defined here.
