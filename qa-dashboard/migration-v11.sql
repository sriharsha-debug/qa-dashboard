-- Migration v11: private per-tester data + leader admin visibility
-- Run this in Supabase SQL Editor.
--
-- Each tester's projects, daily logs, and APK shares become visible only
-- to them — except the team leader, who can see everyone's.

alter table projects add column if not exists owner_id uuid references auth.users(id);
alter table daily_reports add column if not exists owner_id uuid references auth.users(id);
alter table apk_shares add column if not exists owner_id uuid references auth.users(id);

-- Backfill your existing data so it stays visible to you.
-- Replace the email below with your own account's email if different.
update projects set owner_id = (select id from auth.users where email = 'sriharsha@mtouchlabs.com') where owner_id is null;
update daily_reports set owner_id = (select id from auth.users where email = 'sriharsha@mtouchlabs.com') where owner_id is null;
update apk_shares set owner_id = (select id from auth.users where email = 'sriharsha@mtouchlabs.com') where owner_id is null;

-- Helper: is the current user the team leader?
create or replace function is_team_leader() returns boolean
language sql stable security definer as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'leader');
$$;

-- Projects: owner or leader only
drop policy if exists "projects_authenticated_only" on projects;
drop policy if exists "projects_owner_or_leader" on projects;
create policy "projects_owner_or_leader" on projects
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- Daily reports: owner or leader only
drop policy if exists "daily_reports_authenticated_only" on daily_reports;
drop policy if exists "daily_reports_owner_or_leader" on daily_reports;
create policy "daily_reports_owner_or_leader" on daily_reports
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- APK shares: owner or leader only
drop policy if exists "apk_shares_authenticated_only" on apk_shares;
drop policy if exists "apk_shares_owner_or_leader" on apk_shares;
create policy "apk_shares_owner_or_leader" on apk_shares
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- Statuses stay shared/global across the whole team (unchanged).
