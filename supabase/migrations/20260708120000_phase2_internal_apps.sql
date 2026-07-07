-- Phase 2 — Content Calendar + Investor CRM internal apps (no OAuth)

-- ---------------------------------------------------------------------------
-- Content Calendar
-- ---------------------------------------------------------------------------

create table if not exists public.content_campaigns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  description text null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  start_date date null,
  end_date date null,
  owner_employee_id text null,
  created_by_type text not null default 'ai'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.content_posts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  campaign_id text null,
  title text not null,
  body text not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'ready_for_approval', 'approved',
      'scheduled_later', 'published_later', 'archived'
    )),
  scheduled_at timestamptz null,
  platform text not null default 'linkedin'
    check (platform in ('linkedin', 'instagram', 'facebook', 'x', 'blog', 'email')),
  approval_id text null,
  artifact_id text null,
  source_message_id text null,
  created_by_type text not null default 'ai'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, campaign_id)
    references public.content_campaigns(workspace_id, id)
    on delete set null
);

create index if not exists idx_content_posts_campaign
  on public.content_posts (workspace_id, campaign_id, scheduled_at);
create index if not exists idx_content_posts_status
  on public.content_posts (workspace_id, status, scheduled_at desc);

drop trigger if exists set_content_campaigns_updated_at on public.content_campaigns;
create trigger set_content_campaigns_updated_at
before update on public.content_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists set_content_posts_updated_at on public.content_posts;
create trigger set_content_posts_updated_at
before update on public.content_posts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Investor CRM
-- ---------------------------------------------------------------------------

create table if not exists public.investor_firms (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  website text null,
  focus text null,
  stage_focus text null,
  notes text null,
  created_by_type text not null default 'ai'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.investor_contacts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  firm_id text null,
  full_name text not null,
  title text null,
  email text null,
  linkedin_url text null,
  notes text null,
  owner_employee_id text null,
  created_by_type text not null default 'ai'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, firm_id)
    references public.investor_firms(workspace_id, id)
    on delete set null
);

create table if not exists public.investor_pipeline (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  firm_id text null,
  contact_id text null,
  stage text not null default 'target'
    check (stage in (
      'target', 'researched', 'drafted', 'contacted',
      'replied', 'meeting', 'passed', 'committed'
    )),
  fit_score integer null check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  target_amount numeric(14,2) null,
  currency text not null default 'GBP',
  notes text null,
  next_follow_up_at timestamptz null,
  owner_employee_id text null,
  created_by_type text not null default 'ai'
    check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, firm_id)
    references public.investor_firms(workspace_id, id)
    on delete set null,
  foreign key (workspace_id, contact_id)
    references public.investor_contacts(workspace_id, id)
    on delete set null
);

create index if not exists idx_investor_pipeline_stage
  on public.investor_pipeline (workspace_id, stage, updated_at desc);

drop trigger if exists set_investor_firms_updated_at on public.investor_firms;
create trigger set_investor_firms_updated_at
before update on public.investor_firms
for each row execute function public.set_updated_at();

drop trigger if exists set_investor_contacts_updated_at on public.investor_contacts;
create trigger set_investor_contacts_updated_at
before update on public.investor_contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_investor_pipeline_updated_at on public.investor_pipeline;
create trigger set_investor_pipeline_updated_at
before update on public.investor_pipeline
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.content_campaigns enable row level security;
alter table public.content_posts enable row level security;
alter table public.investor_firms enable row level security;
alter table public.investor_contacts enable row level security;
alter table public.investor_pipeline enable row level security;

drop policy if exists "content_campaigns_all_member" on public.content_campaigns;
create policy "content_campaigns_all_member"
on public.content_campaigns for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "content_posts_all_member" on public.content_posts;
create policy "content_posts_all_member"
on public.content_posts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "investor_firms_all_member" on public.investor_firms;
create policy "investor_firms_all_member"
on public.investor_firms for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "investor_contacts_all_member" on public.investor_contacts;
create policy "investor_contacts_all_member"
on public.investor_contacts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "investor_pipeline_all_member" on public.investor_pipeline;
create policy "investor_pipeline_all_member"
on public.investor_pipeline for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Catalog tools for employee grants
-- ---------------------------------------------------------------------------

insert into public.tools (id, name, category, description, status)
values
  ('adehq-calendar', 'AdeHQ Calendar', 'Marketing', 'Campaigns and social content drafts inside AdeHQ.', 'connected'),
  ('adehq-investors', 'AdeHQ Investors', 'Fundraising', 'Investor firms, contacts, and pipeline inside AdeHQ.', 'connected')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status;
