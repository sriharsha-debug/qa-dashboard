-- Migration v26: upload APK files directly instead of only pasting a link
-- Run this in Supabase SQL Editor after migration-v25.sql.
--
-- Until now "APK shares" only stored a link (apk_link) that someone had to
-- paste in from wherever the build was already hosted (Drive, WeTransfer,
-- Firebase App Distribution, etc). This adds real file storage so the .apk
-- can be uploaded straight into the dashboard, e.g. after your dev team
-- drops it in WhatsApp — download it to your device, then upload it here.
--
-- apk_link is left in place and keeps working exactly as before: if a row
-- has an uploaded file, apk_link is set to that file's public URL; if
-- someone just pastes an external link instead of uploading, apk_link
-- stores that link the same as it always has. file_path/file_name/
-- file_size are only populated for uploaded files, and are used to clean
-- up storage when a row is deleted.

alter table apk_shares add column if not exists file_path text;
alter table apk_shares add column if not exists file_name text;
alter table apk_shares add column if not exists file_size bigint;

-- Storage bucket for the uploaded .apk/.aab files. Public so the same
-- "open link" / WhatsApp-share flow that already works for pasted links
-- keeps working for uploaded files too, via their public URL.
insert into storage.buckets (id, name, public)
values ('apk-files', 'apk-files', true)
on conflict (id) do nothing;

-- Anyone signed in to the dashboard can upload, read, and delete APK
-- files — same trust model as every other table here (single shared team,
-- no per-user restriction beyond "must be logged in").
drop policy if exists "apk_files_public_read" on storage.objects;
create policy "apk_files_public_read" on storage.objects
  for select
  using (bucket_id = 'apk-files');

drop policy if exists "apk_files_authenticated_upload" on storage.objects;
create policy "apk_files_authenticated_upload" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'apk-files');

drop policy if exists "apk_files_authenticated_delete" on storage.objects;
create policy "apk_files_authenticated_delete" on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'apk-files');

-- Note on file size limits: Supabase's default per-file upload limit is
-- 50MB. Most APKs fit under that, but if your team ships larger builds,
-- raise it in the Supabase dashboard: Storage → apk-files bucket →
-- Settings → "File size limit" (Free/Pro plans support up to a few GB —
-- check your plan's limit).
