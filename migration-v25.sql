-- Migration v25: Sign Off Date on Daily Log entries
-- Run this in Supabase SQL Editor after migration-v24.sql.
--
-- The Daily Log form now captures its own Sign Off Date per entry
-- (separate from projects.sign_off_date, which still tracks the most
-- recent sign-off at the project level and keeps being kept in sync
-- automatically). This column is nullable, so it's safe to run without
-- touching any existing daily_reports rows.

alter table daily_reports add column if not exists sign_off_date date;

-- The Daily Log fields were narrowed down to: Date, Project, Project
-- Manager, Tasks Assigned, Total Bugs / Bugs Opened / Bugs Closed (live,
-- not stored), Bug Sheet Link, Sign Off, Sign Off Date, Project Deadline
-- (live, from projects.end_date), and Notes.
--
-- The old test_cases / ui_bugs / functionality_bugs / remarks columns are
-- no longer written to by the app, but are left in place (not dropped) so
-- any historical data already logged in them isn't lost. Uncomment below
-- if you're sure you want to drop them permanently:
--
-- alter table daily_reports drop column if exists test_cases;
-- alter table daily_reports drop column if exists ui_bugs;
-- alter table daily_reports drop column if exists functionality_bugs;
-- alter table daily_reports drop column if exists remarks;
