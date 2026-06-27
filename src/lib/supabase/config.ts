export const SUPABASE_PROJECT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://psufoswopnknzhxfyvwa.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_WAMHljbrQbfHMruVyMydUg_Kxls2gKY";

export const SUPABASE_WORKSPACE_TABLES = [
  "ai_employees",
  "employee_tools",
  "project_rooms",
  "room_members",
  "messages",
  "tasks",
  "memory_entries",
  "approvals",
  "work_log_events",
  "calls",
  "call_transcripts",
  "workspace_tools",
  "workspace_invitations",
] as const;
