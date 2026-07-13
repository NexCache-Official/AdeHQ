-- Slice C: AI triage / draft statuses, jobs, approval envelope, rate settings

-- ---------------------------------------------------------------------------
-- Thread triage / draft columns (independent — never overwrite each other)
-- ---------------------------------------------------------------------------
alter table public.email_threads
  add column if not exists triage_status text not null default 'not_started'
    check (triage_status in ('not_started', 'queued', 'running', 'ready', 'failed')),
  add column if not exists draft_status text not null default 'idle'
    check (draft_status in ('idle', 'queued', 'running', 'ready', 'failed', 'cancelled')),
  add column if not exists category text
    check (category is null or category in (
      'sales', 'support', 'billing', 'partnership', 'investor', 'recruiting',
      'operations', 'automated', 'newsletter', 'security', 'general'
    )),
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists reply_required boolean not null default false,
  add column if not exists suggested_employee_id uuid,
  add column if not exists assignment_confidence double precision not null default 0,
  add column if not exists assignment_source text
    check (assignment_source is null or assignment_source in (
      'thread_continuity', 'deterministic_rule', 'role_match', 'classifier', 'human'
    )),
  add column if not exists triage_confidence double precision not null default 0,
  add column if not exists triage_version text not null default 'c1',
  add column if not exists last_triaged_at timestamptz,
  add column if not exists triage_error_code text,
  add column if not exists triage_error_at timestamptz,
  add column if not exists latest_draft_id uuid,
  add column if not exists latest_valid_approval_id uuid,
  add column if not exists steward_meta jsonb not null default '{}'::jsonb;

create index if not exists idx_email_threads_mailbox_triage
  on public.email_threads (mailbox_id, triage_status, last_message_at desc nulls last);

create index if not exists idx_email_threads_mailbox_draft_status
  on public.email_threads (mailbox_id, draft_status, last_message_at desc nulls last);

create index if not exists idx_email_threads_mailbox_priority
  on public.email_threads (mailbox_id, priority, last_message_at desc nulls last)
  where reply_required = true;

-- ---------------------------------------------------------------------------
-- Drafts: AI origin / stale / approval flags
-- ---------------------------------------------------------------------------
alter table public.email_drafts
  add column if not exists origin_type text not null default 'human'
    check (origin_type in ('ai_employee', 'human')),
  add column if not exists current_author_type text not null default 'human'
    check (current_author_type in ('ai_employee', 'human')),
  add column if not exists requires_approval boolean not null default false,
  add column if not exists based_on_message_id uuid references public.email_messages(id) on delete set null,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text,
  add column if not exists employee_id uuid,
  add column if not exists rewrite_count int not null default 0;

-- FK for latest_draft_id (after email_drafts exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_threads_latest_draft_id_fkey'
  ) then
    alter table public.email_threads
      add constraint email_threads_latest_draft_id_fkey
      foreign key (latest_draft_id) references public.email_drafts(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Approvals: full envelope hash + expiry
-- ---------------------------------------------------------------------------
alter table public.email_approvals
  add column if not exists approval_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists from_address text,
  add column if not exists reply_to text,
  add column if not exists mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  add column if not exists thread_id uuid references public.email_threads(id) on delete set null;

create index if not exists idx_email_approvals_pending
  on public.email_approvals (workspace_id, status, expires_at)
  where status = 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_threads_latest_valid_approval_id_fkey'
  ) then
    alter table public.email_threads
      add constraint email_threads_latest_valid_approval_id_fkey
      foreign key (latest_valid_approval_id) references public.email_approvals(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Mailbox Slice C settings
-- ---------------------------------------------------------------------------
alter table public.workspace_mailboxes
  add column if not exists assign_threshold double precision not null default 0.90,
  add column if not exists approval_ttl_hours int not null default 48,
  add column if not exists max_triage_per_minute int not null default 60,
  add column if not exists max_draft_jobs_per_user_per_minute int not null default 10,
  add column if not exists max_concurrent_jobs int not null default 20,
  add column if not exists max_classifier_body_chars int not null default 8000,
  add column if not exists max_draft_context_messages int not null default 12,
  add column if not exists max_rewrites_per_draft int not null default 5;

-- Default new claims to Organise inbox (ai_triage). Existing rows unchanged.
alter table public.workspace_mailboxes
  alter column assistance_mode set default 'ai_triage';

-- ---------------------------------------------------------------------------
-- email_jobs — authoritative running work
-- ---------------------------------------------------------------------------
create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  message_id uuid references public.email_messages(id) on delete set null,
  draft_id uuid references public.email_drafts(id) on delete set null,
  job_type text not null check (job_type in ('triage', 'draft', 'rewrite')),
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempt_count int not null default 0,
  locked_at timestamptz,
  locked_by text,
  available_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (idempotency_key)
);

create index if not exists idx_email_jobs_claim
  on public.email_jobs (status, available_at, created_at)
  where status in ('queued', 'running');

create index if not exists idx_email_jobs_thread
  on public.email_jobs (thread_id, created_at desc)
  where thread_id is not null;

alter table public.email_jobs enable row level security;

drop policy if exists email_jobs_select_member on public.email_jobs;
create policy email_jobs_select_member on public.email_jobs for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = email_jobs.workspace_id
        and wm.user_id = auth.uid()
    )
  );

-- Realtime for job status in UI
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'email_jobs'
  ) then
    alter publication supabase_realtime add table public.email_jobs;
  end if;
end $$;
