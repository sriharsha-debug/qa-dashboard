-- Migration v4: switch security model to Supabase Auth + RLS
-- Run this in Supabase SQL Editor.
--
-- Why: moving off Netlify Identity + Netlify Functions so the app can be
-- deployed as a plain static site anywhere (Vercel, Netlify, etc).
-- The browser now talks to Supabase directly using the public "anon" key
-- (safe to expose — that's what it's for), and these RLS policies make
-- sure only someone who has actually signed in can read or write anything.

alter table projects enable row level security;
alter table daily_reports enable row level security;
alter table statuses enable row level security;

drop policy if exists "projects_authenticated_only" on projects;
create policy "projects_authenticated_only" on projects
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "daily_reports_authenticated_only" on daily_reports;
create policy "daily_reports_authenticated_only" on daily_reports
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "statuses_authenticated_only" on statuses;
create policy "statuses_authenticated_only" on statuses
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
