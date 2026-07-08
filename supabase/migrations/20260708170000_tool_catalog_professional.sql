-- Professional tool catalog: internal apps connected, external integrations labeled correctly.

-- Rename generic calendar row so it doesn't collide with AdeHQ Calendar in the UI.
update public.tools
set
  name = 'Google Calendar',
  description = 'Sync meetings and events from Google Calendar.',
  status = 'coming_soon'
where id = 'calendar';

-- Legacy mock status → coming_soon for third-party tools.
update public.tools
set status = 'coming_soon'
where status = 'mock';

-- Showcase-only integrations that were marked not_connected.
update public.tools
set status = 'coming_soon'
where id in (
  'figma', 'unity', 'blender', 'godot',
  'web-search', 'browser', 'perplexity', 'files',
  'github', 'cursor', 'vercel', 'supabase',
  'notion', 'linear',
  'siliconflow', 'anthropic', 'gemini'
);

-- Internal AdeHQ apps are always connected.
update public.tools
set status = 'connected'
where id like 'adehq-%';

-- Workspace overrides: never downgrade built-in apps.
update public.workspace_tools
set status = 'connected'
where tool_id like 'adehq-%';

-- Refresh AdeHQ Calendar catalog copy.
update public.tools
set
  name = 'AdeHQ Calendar',
  category = 'Business',
  description = 'Plan campaigns, schedule posts, and manage your content calendar inside AdeHQ.',
  status = 'connected'
where id = 'adehq-calendar';

update public.tools
set category = 'Fundraising'
where id = 'adehq-investors';

insert into public.tools (id, name, category, description, status)
values
  ('adehq-team', 'AdeHQ Teamwork', 'Productivity', 'Delegate to and coordinate with other AI employees across shared rooms.', 'connected')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status;
