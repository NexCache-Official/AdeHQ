-- PR-18.2G: private recording storage. Application routes use service-role access
-- after call membership, consent, entitlement, ownership, and retention checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  262144000,
  array['audio/webm', 'video/webm', 'video/mp4', 'audio/mp4']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No authenticated storage policies are created intentionally. Upload, signing,
-- download, retention, and deletion stay behind authenticated server routes.
