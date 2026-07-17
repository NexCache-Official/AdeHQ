-- Profile avatars: public bucket + avatar metadata on profiles.
-- Path convention: {user_id}/avatar.{png|svg|webp}

alter table public.profiles
  add column if not exists avatar_source text
    check (avatar_source is null or avatar_source in ('generated', 'upload')),
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adehq-avatars',
  'adehq-avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (bucket is public); writes limited to own folder
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select
using (bucket_id = 'adehq-avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'adehq-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'adehq-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'adehq-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'adehq-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Service role can manage any avatar (default generation / repair)
drop policy if exists "avatars_service_all" on storage.objects;
create policy "avatars_service_all"
on storage.objects for all
to service_role
using (bucket_id = 'adehq-avatars')
with check (bucket_id = 'adehq-avatars');
