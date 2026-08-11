-- Migration v10: team roles + notifications
-- Run this in Supabase SQL Editor.

-- Profiles: one row per team member, linked to their Supabase Auth account.
-- The FIRST person to sign in after this migration is automatically made
-- the "leader" (the app does this on login). Everyone after that defaults
-- to "member" — the leader can promote/demote people later from the
-- Team tab in the app.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('leader', 'member')),
  last_seen_notifications_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
drop policy if exists "profiles_authenticated_all" on profiles;
create policy "profiles_authenticated_all" on profiles
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Notifications: an activity feed everyone on the team can see.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_email text,
  message text not null,
  entity_type text,
  action text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_created on notifications(created_at desc);

alter table notifications enable row level security;
drop policy if exists "notifications_authenticated_all" on notifications;
create policy "notifications_authenticated_all" on notifications
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Attribution: who created/updated a project, who logged a daily entry.
alter table projects add column if not exists created_by_email text;
alter table projects add column if not exists updated_by_email text;
alter table daily_reports add column if not exists logged_by_email text;
alter table apk_shares add column if not exists logged_by_email text;
