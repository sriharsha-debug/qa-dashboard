-- Migration v21: human-readable Bug ID on bugs
-- Run this in Supabase SQL Editor after migration-v20.sql.
--
-- Adds a free-text "Bug Id" column (e.g. "BUG-001") so testers can track
-- bugs against their own numbering scheme (spreadsheet id, Jira key, etc),
-- separate from the internal uuid primary key. Nullable, so this is safe
-- to run without touching any existing bug rows.

alter table bugs add column if not exists bug_id text;
