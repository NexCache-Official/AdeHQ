-- V20.0.3 — Enable Supabase Realtime for browser research runs and topic messages.
-- Required for live research cards (metadata.liveSessionUrl) and async chat replies.

alter table public.browser_research_runs replica identity full;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'browser_research_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_research_runs;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

comment on table public.browser_research_runs is
  'Browser research runs (mock/tavily/browserbase). Realtime-enabled for live session URLs and run status.';
