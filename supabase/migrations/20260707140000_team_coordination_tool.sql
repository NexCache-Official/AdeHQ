-- Teamwork capability — internal catalog tool backing team.* (delegate /
-- coordinate across shared rooms). Always available, no OAuth.

insert into public.tools (id, name, category, description, status)
values
  ('adehq-team', 'AdeHQ Teamwork', 'Productivity', 'Delegate to and coordinate with other AI employees across shared rooms.', 'connected')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status;
