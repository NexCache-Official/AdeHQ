-- =============================================================================
-- Workspace Inbox foundation (Slice A)
-- Resend transport + Supabase system of record. No AI steward yet (Slice C).
-- =============================================================================

-- Processing / delivery enums as text checks (portable, readable)

create table if not exists public.workspace_mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Immutable routing local-part (never changes when workspace slug/name changes)
  canonical_local_part text not null,
  domain text not null default 'inbox.adehq.com',
  display_name text not null default '',
  is_primary boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'paused', 'disabled')),
  mailbox_type text not null default 'adehq_managed'
    check (mailbox_type in ('adehq_managed', 'google', 'microsoft', 'imap_future')),
  assistance_mode text not null default 'ai_triage_suggested_replies'
    check (assistance_mode in ('manual', 'ai_triage', 'ai_triage_suggested_replies', 'ai_auto_draft')),
  provider_account_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain, canonical_local_part)
);

create unique index if not exists idx_workspace_mailboxes_one_primary
  on public.workspace_mailboxes (workspace_id)
  where is_primary = true;

create index if not exists idx_workspace_mailboxes_workspace
  on public.workspace_mailboxes (workspace_id);

create table if not exists public.mailbox_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  local_part text not null,
  domain text not null default 'inbox.adehq.com',
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (domain, local_part)
);

create index if not exists idx_mailbox_aliases_mailbox
  on public.mailbox_aliases (mailbox_id);

create table if not exists public.email_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  display_name text not null,
  reply_to text,
  signature_html text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_identities_mailbox
  on public.email_identities (mailbox_id);

-- Inbound webhook ingest (service-role writes; members can read after workspace resolved)
create table if not exists public.email_inbound_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  svix_id text,
  provider_email_id text,
  event_type text,
  processing_state text not null default 'received'
    check (processing_state in ('received', 'queued', 'processing', 'ready', 'failed', 'quarantined')),
  raw_payload jsonb not null default '{}'::jsonb,
  error text,
  attempt_count int not null default 0,
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_email_inbound_events_svix
  on public.email_inbound_events (svix_id)
  where svix_id is not null;

-- Only dedupe received messages by provider id; delivery/bounce share the same
-- Resend email_id and must insert as separate inbound events.
create unique index if not exists idx_email_inbound_events_provider_email
  on public.email_inbound_events (provider_email_id)
  where provider_email_id is not null and event_type = 'email.received';

create index if not exists idx_email_inbound_events_state
  on public.email_inbound_events (processing_state, created_at);

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  subject text not null default '',
  normalised_subject text,
  status text not null default 'open'
    check (status in ('open', 'awaiting_reply', 'closed', 'archived', 'spam')),
  folder text not null default 'inbox'
    check (folder in (
      'inbox', 'assigned', 'needs_approval', 'drafts', 'sent',
      'awaiting_reply', 'ai_working', 'scheduled', 'archived', 'spam'
    )),
  assigned_human_id uuid references auth.users(id) on delete set null,
  assigned_employee_id uuid,
  assigned_team_id uuid,
  requires_approval boolean not null default false,
  processing_state text not null default 'ready'
    check (processing_state in ('received', 'queued', 'processing', 'ready', 'failed', 'quarantined')),
  contact_id uuid,
  deal_id uuid,
  last_message_at timestamptz,
  provider_thread_id text,
  mailbox_type text not null default 'adehq_managed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_threads_mailbox_last
  on public.email_threads (mailbox_id, last_message_at desc nulls last);

create index if not exists idx_email_threads_workspace_folder
  on public.email_threads (workspace_id, folder, last_message_at desc nulls last);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  from_address text,
  from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  reply_to text,
  subject text not null default '',
  text_body text,
  html_body_raw text,
  html_body_sanitised text,
  headers jsonb not null default '{}'::jsonb,
  message_id_header text,
  in_reply_to_header text,
  references_header text,
  provider_message_id text,
  provider_email_id text,
  provider_thread_id text,
  mailbox_type text not null default 'adehq_managed',
  sent_by_type text check (sent_by_type is null or sent_by_type in ('human', 'ai_employee', 'system')),
  sent_by_id text,
  delivery_status text not null default 'received'
    check (delivery_status in (
      'received', 'queued', 'sending', 'sent', 'delivered',
      'bounced', 'complained', 'failed', 'cancelled'
    )),
  security_flags text[] not null default '{}',
  raw_mime_storage_path text,
  inbound_event_id uuid references public.email_inbound_events(id) on delete set null,
  outbox_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_email_messages_message_id_header
  on public.email_messages (workspace_id, message_id_header)
  where message_id_header is not null;

create unique index if not exists idx_email_messages_provider_email
  on public.email_messages (provider_email_id)
  where provider_email_id is not null;

create index if not exists idx_email_messages_thread
  on public.email_messages (thread_id, created_at);

create index if not exists idx_email_messages_in_reply_to
  on public.email_messages (workspace_id, in_reply_to_header)
  where in_reply_to_header is not null;

create table if not exists public.email_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null references public.email_messages(id) on delete cascade,
  role text not null check (role in ('from', 'to', 'cc', 'bcc', 'reply_to')),
  address text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_participants_message
  on public.email_participants (message_id);

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null references public.email_messages(id) on delete cascade,
  filename text,
  content_type text,
  size_bytes bigint,
  content_id text,
  content_disposition text,
  storage_path text,
  provider_attachment_id text,
  quarantine_state text not null default 'clean'
    check (quarantine_state in ('clean', 'quarantined', 'blocked', 'pending_scan')),
  security_flags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_email_attachments_message
  on public.email_attachments (message_id);

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  artifact_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'sent', 'discarded')),
  created_by_type text not null check (created_by_type in ('human', 'ai_employee', 'system')),
  created_by_id text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_draft_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  version_number int not null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  subject text not null default '',
  text_body text,
  html_body text,
  attachment_meta jsonb not null default '[]'::jsonb,
  content_hash text not null,
  is_original_ai boolean not null default false,
  created_by_type text not null check (created_by_type in ('human', 'ai_employee', 'system')),
  created_by_id text not null,
  created_at timestamptz not null default now(),
  unique (draft_id, version_number)
);

alter table public.email_drafts
  drop constraint if exists email_drafts_current_version_id_fkey;
alter table public.email_drafts
  add constraint email_drafts_current_version_id_fkey
  foreign key (current_version_id) references public.email_draft_versions(id) on delete set null;

create table if not exists public.email_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  draft_version_id uuid not null references public.email_draft_versions(id) on delete cascade,
  recipient_hash text not null,
  subject_hash text not null,
  body_hash text not null,
  attachment_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'invalidated')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_approvals_draft
  on public.email_approvals (draft_id, created_at desc);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  draft_id uuid references public.email_drafts(id) on delete set null,
  draft_version_id uuid references public.email_draft_versions(id) on delete set null,
  approval_id uuid references public.email_approvals(id) on delete set null,
  message_id uuid references public.email_messages(id) on delete set null,
  status text not null default 'queued'
    check (status in (
      'draft', 'pending_approval', 'approved', 'queued', 'sending',
      'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled'
    )),
  idempotency_key text not null unique,
  provider_message_id text,
  from_address text not null,
  from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  subject text not null default '',
  text_body text,
  html_body text,
  headers jsonb not null default '{}'::jsonb,
  attachment_payload jsonb not null default '[]'::jsonb,
  sent_by_type text check (sent_by_type is null or sent_by_type in ('human', 'ai_employee', 'system')),
  sent_by_id text,
  error text,
  attempt_count int not null default 0,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_outbox_claim
  on public.email_outbox (status, created_at)
  where status in ('queued', 'approved');

alter table public.email_messages
  drop constraint if exists email_messages_outbox_id_fkey;
alter table public.email_messages
  add constraint email_messages_outbox_id_fkey
  foreign key (outbox_id) references public.email_outbox(id) on delete set null;

create table if not exists public.email_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  assigned_human_id uuid references auth.users(id) on delete set null,
  assigned_employee_id uuid,
  assigned_team_id uuid,
  assigned_by_type text check (assigned_by_type is null or assigned_by_type in ('human', 'ai_employee', 'system')),
  assigned_by_id text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_assignments_thread
  on public.email_assignments (thread_id, created_at desc);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  thread_id uuid references public.email_threads(id) on delete set null,
  message_id uuid references public.email_messages(id) on delete set null,
  actor_type text check (actor_type is null or actor_type in ('human', 'ai_employee', 'system', 'provider')),
  actor_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_events_thread
  on public.email_events (thread_id, created_at desc);

create index if not exists idx_email_events_workspace
  on public.email_events (workspace_id, created_at desc);

create table if not exists public.email_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.email_thread_labels (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  label_id uuid not null references public.email_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, label_id)
);

create table if not exists public.email_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  priority int not null default 100,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  address text not null,
  reason text not null check (reason in ('bounce', 'complaint', 'unsubscribe', 'manual')),
  source_message_id uuid references public.email_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, address)
);

-- updated_at triggers
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_mailboxes', 'email_identities', 'email_inbound_events',
    'email_threads', 'email_messages', 'email_drafts', 'email_outbox', 'email_rules'
  ]
  loop
    execute format('drop trigger if exists set_%s_updated_at on public.%I', t, t);
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- RLS
alter table public.workspace_mailboxes enable row level security;
alter table public.mailbox_aliases enable row level security;
alter table public.email_identities enable row level security;
alter table public.email_inbound_events enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_participants enable row level security;
alter table public.email_attachments enable row level security;
alter table public.email_drafts enable row level security;
alter table public.email_draft_versions enable row level security;
alter table public.email_approvals enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_assignments enable row level security;
alter table public.email_events enable row level security;
alter table public.email_labels enable row level security;
alter table public.email_thread_labels enable row level security;
alter table public.email_rules enable row level security;
alter table public.email_suppressions enable row level security;

-- Member CRUD helpers (service role bypasses RLS for webhooks/workers)
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_mailboxes', 'mailbox_aliases', 'email_identities',
    'email_threads', 'email_messages', 'email_participants', 'email_attachments',
    'email_drafts', 'email_draft_versions', 'email_approvals', 'email_outbox',
    'email_assignments', 'email_events', 'email_labels', 'email_thread_labels',
    'email_rules', 'email_suppressions'
  ]
  loop
    execute format('drop policy if exists %I_select_member on public.%I', t, t);
    execute format(
      'create policy %I_select_member on public.%I for select
       using (public.is_workspace_member(workspace_id))', t, t);

    execute format('drop policy if exists %I_insert_member on public.%I', t, t);
    execute format(
      'create policy %I_insert_member on public.%I for insert
       with check (public.is_workspace_member(workspace_id))', t, t);

    execute format('drop policy if exists %I_update_member on public.%I', t, t);
    execute format(
      'create policy %I_update_member on public.%I for update
       using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id))', t, t);

    execute format('drop policy if exists %I_delete_member on public.%I', t, t);
    execute format(
      'create policy %I_delete_member on public.%I for delete
       using (public.is_workspace_member(workspace_id))', t, t);
  end loop;
end $$;

-- Inbound events: members can read once workspace_id is set; writes via service role
drop policy if exists email_inbound_events_select_member on public.email_inbound_events;
create policy email_inbound_events_select_member
  on public.email_inbound_events for select
  using (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
  );

-- Private storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('email-attachments', 'email-attachments', false, 41943040, null),
  ('email-raw-mime', 'email-raw-mime', false, 52428800, null)
on conflict (id) do update set public = excluded.public;

do $$
declare
  bucket_id text;
begin
  foreach bucket_id in array array['email-attachments', 'email-raw-mime']
  loop
    execute format('drop policy if exists %I on storage.objects', bucket_id || '_select');
    execute format(
      $p$
      create policy %I on storage.objects for select
      using (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_select',
      bucket_id
    );

    execute format('drop policy if exists %I on storage.objects', bucket_id || '_insert');
    execute format(
      $p$
      create policy %I on storage.objects for insert
      with check (
        bucket_id = %L
        and public.is_active_workspace_member(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_insert',
      bucket_id
    );

    execute format('drop policy if exists %I on storage.objects', bucket_id || '_delete');
    execute format(
      $p$
      create policy %I on storage.objects for delete
      using (
        bucket_id = %L
        and public.is_workspace_admin(((storage.foldername(name))[1])::uuid)
      )
      $p$,
      bucket_id || '_delete',
      bucket_id
    );
  end loop;
end $$;

-- Realtime for inbox UI (Slice B)
do $$
declare
  t text;
begin
  foreach t in array array['email_threads', 'email_messages', 'email_outbox', 'email_drafts']
  loop
    if to_regclass('public.' || t) is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
