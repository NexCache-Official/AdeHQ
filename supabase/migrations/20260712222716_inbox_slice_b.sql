-- =============================================================================
-- Workspace Inbox Slice B
-- Query-based folders, mailbox permissions, claim-first, idempotent send,
-- address tombstones. Existing auto-provisioned mailboxes remain valid.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Thread operational fields (folders become queries, not a mutable column)
-- ---------------------------------------------------------------------------

-- Drop the old status check BEFORE remapping values (avoids check violations).
alter table public.email_threads
  drop constraint if exists email_threads_status_check;

update public.email_threads
set status = case status
  when 'awaiting_reply' then 'waiting'
  when 'closed' then 'resolved'
  when 'spam' then 'archived'
  else status
end
where status in ('awaiting_reply', 'closed', 'spam');

alter table public.email_threads
  add constraint email_threads_status_check
  check (status in ('open', 'waiting', 'resolved', 'archived'));

alter table public.email_threads
  add column if not exists direction_state text not null default 'inbound'
    check (direction_state in ('inbound', 'outbound', 'mixed'));

alter table public.email_threads
  add column if not exists latest_direction text
    check (latest_direction is null or latest_direction in ('inbound', 'outbound', 'internal'));

alter table public.email_threads
  add column if not exists has_unread boolean not null default false;

alter table public.email_threads
  add column if not exists is_spam boolean not null default false;

-- Backfill direction_state / latest_direction / has_unread / is_spam from messages
-- and the legacy folder column.
update public.email_threads t
set is_spam = true
where t.folder = 'spam' and t.is_spam = false;

with msg_agg as (
  select
    m.thread_id,
    bool_or(m.direction = 'inbound') as has_in,
    bool_or(m.direction = 'outbound') as has_out,
    (
      select m2.direction
      from public.email_messages m2
      where m2.thread_id = m.thread_id
        and m2.direction in ('inbound', 'outbound')
      order by m2.created_at desc
      limit 1
    ) as latest_ext
  from public.email_messages m
  group by m.thread_id
)
update public.email_threads t
set
  direction_state = case
    when a.has_in and a.has_out then 'mixed'
    when a.has_out then 'outbound'
    else 'inbound'
  end,
  latest_direction = a.latest_ext,
  has_unread = case
    when t.folder = 'inbox' and coalesce(a.latest_ext, 'inbound') = 'inbound' then true
    else t.has_unread
  end
from msg_agg a
where a.thread_id = t.id;

create index if not exists idx_email_threads_mailbox_state
  on public.email_threads (mailbox_id, status, is_spam, latest_direction, last_message_at desc nulls last);

create index if not exists idx_email_threads_mailbox_spam
  on public.email_threads (mailbox_id, last_message_at desc nulls last)
  where is_spam = true;

create index if not exists idx_email_threads_mailbox_archived
  on public.email_threads (mailbox_id, last_message_at desc nulls last)
  where status = 'archived';

-- ---------------------------------------------------------------------------
-- Outbox client_send_id (idempotent human sends)
-- ---------------------------------------------------------------------------

alter table public.email_outbox
  add column if not exists client_send_id text;

create unique index if not exists idx_email_outbox_client_send
  on public.email_outbox (mailbox_id, client_send_id)
  where client_send_id is not null;

-- ---------------------------------------------------------------------------
-- Mailbox status: retired (address tombstone — never recycle)
-- ---------------------------------------------------------------------------

alter table public.workspace_mailboxes
  drop constraint if exists workspace_mailboxes_status_check;

alter table public.workspace_mailboxes
  add constraint workspace_mailboxes_status_check
  check (status in ('active', 'paused', 'disabled', 'retired'));

create table if not exists public.mailbox_address_reservations (
  domain text not null,
  local_part text not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  mailbox_id uuid,
  retired_at timestamptz not null default now(),
  reason text not null default 'retired',
  primary key (domain, local_part)
);

-- ---------------------------------------------------------------------------
-- Mailbox access grants (manager/member; owner/admin are implicit in app)
-- ---------------------------------------------------------------------------

create table if not exists public.email_mailbox_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_read boolean not null default false,
  can_send boolean not null default false,
  can_manage boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, user_id)
);

create index if not exists idx_email_mailbox_access_user
  on public.email_mailbox_access (user_id, workspace_id);

drop trigger if exists set_email_mailbox_access_updated_at on public.email_mailbox_access;
create trigger set_email_mailbox_access_updated_at
  before update on public.email_mailbox_access
  for each row execute function public.set_updated_at();

-- Seed owner/admin grants for existing primary mailboxes
insert into public.email_mailbox_access (
  workspace_id, mailbox_id, user_id, can_read, can_send, can_manage
)
select
  m.workspace_id,
  m.id,
  wm.user_id,
  true,
  true,
  true
from public.workspace_mailboxes m
join public.workspace_members wm
  on wm.workspace_id = m.workspace_id
 and wm.status = 'active'
 and wm.role in ('owner', 'admin')
where m.is_primary = true
  and m.status = 'active'
on conflict (mailbox_id, user_id) do update
set
  can_read = true,
  can_send = true,
  can_manage = true;

-- ---------------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------------

alter table public.email_mailbox_access enable row level security;
alter table public.mailbox_address_reservations enable row level security;

drop policy if exists email_mailbox_access_select_member on public.email_mailbox_access;
create policy email_mailbox_access_select_member
  on public.email_mailbox_access for select
  using (
    public.is_workspace_member(workspace_id)
    and (
      user_id = auth.uid()
      or public.is_workspace_admin(workspace_id)
    )
  );

-- Writes only via service role (API). No insert/update/delete policies for members.

-- Reservations: no public read (service role only). Empty select policy omitted.

-- ---------------------------------------------------------------------------
-- Realtime: mailbox access changes (optional for future grant UI)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.email_mailbox_access') is not null
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'email_mailbox_access'
    )
  then
    execute 'alter publication supabase_realtime add table public.email_mailbox_access';
  end if;
end $$;
