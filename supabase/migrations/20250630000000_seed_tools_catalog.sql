-- Global tool catalog required by workspace_tools and employee_tools FK constraints.
insert into public.tools (id, name, category, description, status)
values
  ('web-search', 'Web Search', 'Research', 'Search the live web for fresh information and sources.', 'mock'),
  ('browser', 'Browser', 'Research', 'Open and read web pages like a human researcher.', 'mock'),
  ('perplexity', 'Perplexity', 'Research', 'Answer engine for deep, cited research.', 'mock'),
  ('files', 'Files', 'Storage', 'Read and write project files and documents.', 'mock'),
  ('google-drive', 'Google Drive', 'Storage', 'Access shared docs, sheets, and folders.', 'not_connected'),
  ('github', 'GitHub', 'Coding', 'Read repos, open PRs, and manage issues.', 'mock'),
  ('cursor', 'Cursor', 'Coding', 'Pair-program inside the codebase.', 'mock'),
  ('vercel', 'Vercel', 'Coding', 'Deploy previews and inspect production.', 'mock'),
  ('supabase', 'Supabase', 'Coding', 'Query the database and manage schema.', 'mock'),
  ('figma', 'Figma', 'Design', 'Read design files and leave critique.', 'not_connected'),
  ('notion', 'Notion', 'Productivity', 'Read and write docs, specs, and wikis.', 'mock'),
  ('linear', 'Linear', 'Productivity', 'Create and track issues and cycles.', 'mock'),
  ('slack', 'Slack', 'Communication', 'Post updates and read channels.', 'not_connected'),
  ('discord', 'Discord', 'Communication', 'Engage your community server.', 'not_connected'),
  ('gmail', 'Gmail', 'Communication', 'Draft and send email (with approval).', 'not_connected'),
  ('calendar', 'Calendar', 'Productivity', 'Schedule meetings and standups.', 'not_connected'),
  ('unity', 'Unity', 'Game development', 'Inspect Unity scenes and assets.', 'not_connected'),
  ('godot', 'Godot', 'Game development', 'Work with Godot scenes and scripts.', 'mock'),
  ('blender', 'Blender', 'Game development', 'Generate and tweak 3D assets.', 'not_connected'),
  ('stripe', 'Stripe', 'Business', 'Inspect payments and revenue (with approval).', 'not_connected'),
  ('siliconflow', 'SiliconFlow', 'Model providers', 'DeepSeek, Qwen, Kimi, and more.', 'mock'),
  ('anthropic', 'Anthropic', 'Model providers', 'Claude models for reasoning and writing.', 'mock'),
  ('gemini', 'Gemini', 'Model providers', 'Google multimodal models.', 'mock')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

notify pgrst, 'reload schema';
