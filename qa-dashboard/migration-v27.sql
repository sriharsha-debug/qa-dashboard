-- Migration v27: quick_notes table for the dashboard-embedded "notepad"
-- Run this in Supabase SQL Editor after migration-v26.sql.
--
-- Backs the two textboxes on the Bugs tab: one where you type
-- ### BUG / ### PROJECT blocks (same format as the local notes-file
-- automation), and one where you paste an AI reply back. The local
-- qa-automation watcher script polls this table instead of a local
-- file when running in "dashboard notes" mode.
--
-- One row per user (owner_id is unique) — it's a personal scratchpad,
-- not shared between team members.

create table if not exists quick_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  notes_content text not null default '',
  ai_reply_content text not null default '',
  updated_at timestamptz not null default now()
);

alter table quick_notes enable row level security;
create policy "quick_notes_owner" on quick_notes
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
