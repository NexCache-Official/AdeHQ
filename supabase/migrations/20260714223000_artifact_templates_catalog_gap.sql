-- Seed missing artifact_templates referenced by tool schemas / hydrate paths.
-- FK on artifact_runs.template_id was failing for business_brief / lead_list / pptx ids.

insert into public.artifact_templates (id, name, artifact_kind, description, schema_json, engine)
values
  ('lead_list', 'Lead List Workbook', 'spreadsheet', 'Prospect/lead list workbook with research-oriented columns.', '{"columns":["Name","Company","Area","Portfolio","Email / Phone","Source URL","Priority","Why now"]}'::jsonb, 'exceljs'),
  ('business_brief', 'Business Brief Document', 'document', 'SOW/RFP-style business brief for DOCX generation.', '{}'::jsonb, 'docx'),
  ('research_report', 'Research Report Document', 'document', 'Longer research report for DOCX generation.', '{}'::jsonb, 'docx'),
  ('sales_deck', 'Sales Deck', 'presentation', 'Sales / ops board PowerPoint template id.', '{}'::jsonb, 'pptx'),
  ('investor_update', 'Investor Update Deck', 'presentation', 'Investor update PowerPoint template id.', '{}'::jsonb, 'pptx'),
  ('campaign_review', 'Campaign Review Deck', 'presentation', 'Campaign review PowerPoint template id.', '{}'::jsonb, 'pptx'),
  ('research_brief', 'Research Brief Deck', 'presentation', 'Research brief PowerPoint template id.', '{}'::jsonb, 'pptx')
on conflict (id) do update set
  name = excluded.name,
  artifact_kind = excluded.artifact_kind,
  description = excluded.description,
  schema_json = excluded.schema_json,
  engine = excluded.engine,
  status = 'active',
  updated_at = now();
