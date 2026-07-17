-- PR-18 Voice: audio artifacts, private audio storage, STT metering column

-- Artifact type: audio
alter table public.artifacts
  drop constraint if exists artifacts_artifact_type_check;
alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (
    artifact_type in (
      'document', 'spreadsheet', 'presentation', 'pdf',
      'email_draft', 'brief', 'report', 'plan',
      'note', 'other', 'image', 'video', 'audio'
    )
  );

-- Ledger: audio seconds for STT
alter table public.ai_cost_ledger_entries
  add column if not exists audio_seconds numeric(12,3) not null default 0;

-- Workspace voice policy (member-safe controls; no model names)
alter table public.workspaces
  add column if not exists voice_settings jsonb not null default '{
    "voiceEnabled": true,
    "premiumVoicesAllowed": false,
    "maxAudioSeconds": 600,
    "retentionDays": 90,
    "meetingTranscriptionAllowed": true,
    "diarizationAllowed": true
  }'::jsonb;

-- Employee voice identity (never impersonate real people)
alter table public.ai_employees
  add column if not exists voice_profile jsonb not null default '{
    "voiceEnabled": true,
    "voiceStyle": "professional",
    "premiumVoiceAllowed": false
  }'::jsonb;

-- Async voice jobs (long meetings)
create table if not exists public.brain_voice_jobs (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text,
  topic_id text,
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  employee_id text,
  kind text not null check (kind in ('voice_note_stt', 'meeting_stt', 'tts')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  route_id text,
  audio_file_id text,
  audio_export_id text,
  artifact_id text,
  estimated_wh_min numeric(12,4) not null default 0,
  estimated_wh_max numeric(12,4) not null default 0,
  actual_wh numeric(12,4) not null default 0,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_brain_voice_jobs_workspace
  on public.brain_voice_jobs (workspace_id, created_at desc);

alter table public.brain_voice_jobs enable row level security;

-- Private audio bucket (path-scoped; service role uploads)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adehq-audio',
  'adehq-audio',
  false,
  104857600,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg',
    'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/aac'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
