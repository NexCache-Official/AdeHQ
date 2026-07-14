-- Slice E: CRM linkage + Slice D hotfix (text IDs for employees / CRM)

-- ---------------------------------------------------------------------------
-- E0a: AI employee assignment columns must be text (ai_employees.id is text)
-- ---------------------------------------------------------------------------
alter table public.email_threads
  alter column assigned_employee_id type text using assigned_employee_id::text;

alter table public.email_threads
  alter column suggested_employee_id type text using suggested_employee_id::text;

alter table public.email_drafts
  alter column employee_id type text using employee_id::text;

create index if not exists idx_email_threads_assigned_employee
  on public.email_threads (workspace_id, assigned_employee_id)
  where assigned_employee_id is not null;

-- ---------------------------------------------------------------------------
-- E0: CRM contact/deal linkage (CRM ids are text, not uuid)
-- ---------------------------------------------------------------------------
alter table public.email_threads
  alter column contact_id type text using contact_id::text;

alter table public.email_threads
  alter column deal_id type text using deal_id::text;

-- Drop any prior invalid FKs if present, then add composite FKs.
alter table public.email_threads
  drop constraint if exists email_threads_contact_id_fkey;
alter table public.email_threads
  drop constraint if exists email_threads_deal_id_fkey;
alter table public.email_threads
  drop constraint if exists email_threads_contact_fk;
alter table public.email_threads
  drop constraint if exists email_threads_deal_fk;

alter table public.email_threads
  add constraint email_threads_contact_fk
  foreign key (workspace_id, contact_id)
  references public.crm_contacts (workspace_id, id)
  on delete set null;

alter table public.email_threads
  add constraint email_threads_deal_fk
  foreign key (workspace_id, deal_id)
  references public.crm_deals (workspace_id, id)
  on delete set null;

create index if not exists idx_email_threads_contact
  on public.email_threads (workspace_id, contact_id)
  where contact_id is not null;

create index if not exists idx_email_threads_deal
  on public.email_threads (workspace_id, deal_id)
  where deal_id is not null;

comment on column public.email_threads.assigned_employee_id is
  'AI employee id (text, matches ai_employees.id). Slice E0a.';
comment on column public.email_threads.contact_id is
  'CRM contact id (text). Slice E.';
comment on column public.email_threads.deal_id is
  'CRM deal id (text). Slice E.';
