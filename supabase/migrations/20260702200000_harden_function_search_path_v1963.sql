-- V19.6.3 hardening: pin a stable search_path on the shared updated-at trigger
-- function. A mutable search_path on a function used across many tables' triggers
-- is a latent privilege-escalation surface (flagged by the Supabase security linter,
-- lint 0011_function_search_path_mutable). Pinning it is behaviour-preserving.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp';
  END IF;
END $$;
