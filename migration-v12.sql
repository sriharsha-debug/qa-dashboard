-- Migration v12: scope notifications to leader-sees-all, members-see-own-only
-- Run this in Supabase SQL Editor.
--
-- Without this, notifications leak every member's activity to every other
-- member, which breaks the private-per-tester setup from migration-v11.

drop policy if exists "notifications_authenticated_all" on notifications;

create policy "notifications_select_own_or_leader" on notifications
  for select
  using (actor_id = auth.uid() or is_team_leader());

create policy "notifications_insert_own" on notifications
  for insert
  with check (actor_id = auth.uid());
