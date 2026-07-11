-- Enable Supabase Realtime for every table the client subscribes to via
-- SUPABASE_WORKSPACE_TABLES (src/lib/supabase/config.ts). Only
-- browser_research_runs and messages were ever added to the
-- supabase_realtime publication (see 20260705012711_browser_research_realtime.sql),
-- so postgres_changes events for tasks, CRM records, etc. were never emitted —
-- the client subscription was correct but Postgres never sent it anything,
-- so boards like /tasks and /crm required a hard navigation to reflect new
-- rows created by AI employees via chat tool calls.

DO $$
DECLARE
  workspace_table text;
  workspace_tables text[] := ARRAY[
    'ai_employees', 'employee_tools', 'rooms', 'topics', 'topic_members',
    'room_members', 'messages', 'tasks', 'memory_entries', 'approvals',
    'work_log_events', 'calls', 'call_transcripts', 'workspace_tools',
    'workspace_invitations', 'workspace_ai_settings', 'ai_usage_events',
    'agent_runs', 'agent_run_steps', 'ai_model_catalog',
    'ai_model_price_snapshots', 'ai_model_sync_runs', 'ai_model_route_health',
    'ai_work_units', 'browser_research_runs', 'workspace_search_cache',
    'topic_search_inflight', 'topic_orchestration_state',
    'topic_context_imports', 'ai_work_minutes_ledger',
    'ai_work_hours_simulation_events', 'workspace_files', 'file_chunks',
    'artifacts', 'artifact_versions', 'drive_folders', 'browser_evidence',
    'drive_exports', 'workspace_storage_quotas', 'storage_usage_events',
    'message_attachments', 'work_graph_edges',
    'crm_companies', 'crm_contacts', 'crm_pipeline_stages', 'crm_deals'
  ];
BEGIN
  FOREACH workspace_table IN ARRAY workspace_tables LOOP
    IF to_regclass('public.' || workspace_table) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = workspace_table
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', workspace_table);
    END IF;
  END LOOP;
END $$;
