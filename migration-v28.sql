-- Migration v28: test-case "quick doc" columns on quick_notes
-- Run this in Supabase SQL Editor after migration-v27.sql.
--
-- Backs the new script-driven test case panel on the Test Execution tab:
-- paste requirements text + save, the local qa-automation watchDashboard
-- script (npm run watch-dashboard) picks it up, copies the AI prompt to
-- your clipboard, opens Claude.ai, and finishes once you paste the reply
-- into the matching reply box.

alter table quick_notes
  add column if not exists tc_project_id uuid references projects(id) on delete set null,
  add column if not exists tc_document_content text not null default '',
  add column if not exists tc_ai_reply_content text not null default '';
