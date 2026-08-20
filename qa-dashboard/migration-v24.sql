-- Migration v24: Prevent duplicate Daily Log entries
-- Run this in Supabase SQL Editor after migration-v23.sql.
--
-- Optional, belt-and-suspenders fix alongside the app.js double-submit
-- guard: adds a unique index so the same project can't get two Daily Log
-- rows with the same report_date AND the same logged_by_email. This still
-- allows different team members to each log their own entry for a project
-- on the same day (matches the existing "mergeReportsForProject" behavior
-- in app.js), it just blocks true duplicates.
--
-- If you already have duplicate rows sitting in daily_reports, delete the
-- extras first (via the "remove" link on the Daily Log tab) or this
-- migration will fail with a "could not create unique index" error.

create unique index if not exists idx_daily_reports_no_dupes
  on daily_reports (project_id, report_date, logged_by_email);
