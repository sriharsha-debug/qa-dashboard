-- Migration v19: professional bug-sheet columns on bugs
-- Run this in Supabase SQL Editor after migration-v18.sql.
--
-- Adds the columns testers expect from a full bug-tracking sheet: Module /
-- Sub Module (grouping, in addition to the existing "page" field), Steps to
-- Reproduce / Expected Result / Actual Result (replacing free-text
-- Description for new bugs — the old "description" column is untouched, so
-- existing bugs keep their data), Developer Status, Retest Status,
-- Developer Comments, and Manager Comments.
--
-- All new columns are nullable (or have a sensible default), so this is
-- safe to run without touching any existing bug rows.

alter table bugs add column if not exists module text;
alter table bugs add column if not exists sub_module text;
alter table bugs add column if not exists steps_to_reproduce text;
alter table bugs add column if not exists expected_result text;
alter table bugs add column if not exists actual_result text;
alter table bugs add column if not exists developer_comments text;
alter table bugs add column if not exists manager_comments text;

alter table bugs add column if not exists developer_status text
  not null default 'Not Started';
alter table bugs drop constraint if exists bugs_developer_status_check;
alter table bugs add constraint bugs_developer_status_check
  check (developer_status in ('Not Started', 'In Progress', 'Fixed', 'Cannot Reproduce', 'Need Info', 'Won''t Fix'));

alter table bugs add column if not exists retest_status text
  not null default 'Not Retested';
alter table bugs drop constraint if exists bugs_retest_status_check;
alter table bugs add constraint bugs_retest_status_check
  check (retest_status in ('Not Retested', 'Pass', 'Fail', 'Blocked'));
