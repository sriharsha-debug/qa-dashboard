-- Migration v20: allow the leader to clear audit log entries
-- Run this in Supabase SQL Editor after migration-v19.sql.
--
-- audit_logs was originally append-only (no delete policy at all). Adding
-- a delete policy so the leader can purge old entries to manage storage,
-- since that's now wanted. Only the leader could ever see these rows
-- (see audit_logs_leader_select), so only the leader can clear them too.

drop policy if exists "audit_logs_leader_delete" on audit_logs;
create policy "audit_logs_leader_delete" on audit_logs
  for delete
  using (is_team_leader());
