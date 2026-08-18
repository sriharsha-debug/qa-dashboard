-- Migration v22: Issue Type on bugs
-- Run this in Supabase SQL Editor after migration-v21.sql.
--
-- Adds an "Issue Type" classification (Functional, UI/UX, Backend, etc.) so
-- bugs can be grouped by the kind of issue they are, not just severity/status.
-- Defaults existing and new rows to 'Functional' so this is safe to run
-- without touching any existing bug rows.

alter table bugs add column if not exists issue_type text
  not null default 'Functional';
alter table bugs drop constraint if exists bugs_issue_type_check;
alter table bugs add constraint bugs_issue_type_check
  check (issue_type in ('Functional', 'UI/UX', 'Backend', 'Frontend', 'API', 'Performance', 'Security', 'Database', 'Other'));
