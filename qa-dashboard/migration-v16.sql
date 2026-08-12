-- Migration v16: automatic daily notification cleanup
-- Run this in Supabase SQL Editor.
--
-- IMPORTANT — one manual step first:
-- Go to Supabase Dashboard → Database → Extensions, search for "pg_cron",
-- and enable it. Then run this migration.

-- Missing piece: there was no DELETE policy on notifications at all, so the
-- "Clear my notifications" buttons and the automatic cleanup would be
-- silently blocked by RLS. Add one: users can delete their own, leader can
-- delete anyone's.
drop policy if exists "notifications_delete_own_or_leader" on notifications;
create policy "notifications_delete_own_or_leader" on notifications
  for delete
  using (actor_id = auth.uid() or is_team_leader());

create extension if not exists pg_cron;

-- Remove any existing job with this name first (safe to run repeatedly)
select cron.unschedule('daily-notification-cleanup')
where exists (select 1 from cron.job where jobname = 'daily-notification-cleanup');

-- Runs every day at 3:00 AM UTC, deletes notifications older than 30 days
select cron.schedule(
  'daily-notification-cleanup',
  '0 3 * * *',
  $$ delete from notifications where created_at < now() - interval '30 days'; $$
);
