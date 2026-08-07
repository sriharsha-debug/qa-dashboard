-- QA Dashboard schema
-- Run this in Supabase: Project → SQL Editor → New Query → paste → Run

create extension if not exists "pgcrypto";

create table if not exists statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#12747D',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into statuses (name, color, sort_order) values
  ('Not Started', '#6B7280', 0),
  ('In Progress', '#A9761E', 1),
  ('Blocked', '#A63D26', 2),
  ('Done', '#1F7A6C', 3)
on conflict (name) do nothing;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  status text not null default 'Not Started',
  start_date date,
  end_date date,
  bugsheet text,
  project_document text,
  project_manager text,
  kt_date date,
  ui_testing_start_date date,
  ui_testing_end_date date,
  functional_testing_start_date date,
  functional_testing_end_date date,
  mobile_app_developers text,
  web_developers text,
  backend_developers text,
  clients_review text,
  sign_off_date date,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apk_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  version text,
  apk_link text,
  shared_date date not null default current_date,
  shared_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_apk_shares_project on apk_shares(project_id);

create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  report_date date not null default current_date,
  project_manager text,
  assigned_tasks text,
  bugsheet text,
  test_cases integer default 0,
  ui_bugs integer default 0,
  functionality_bugs integer default 0,
  remarks text,
  sign_off boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_reports_project on daily_reports(project_id);
create index if not exists idx_daily_reports_date on daily_reports(report_date desc);

-- Row Level Security: the browser talks to Supabase directly using the
-- public "anon" key (safe to expose). Each tester's projects, daily logs,
-- and APK shares are private to them — except the team leader, who can
-- see and manage everyone's.
alter table projects enable row level security;
alter table daily_reports enable row level security;
alter table statuses enable row level security;
alter table apk_shares enable row level security;

create or replace function is_team_leader() returns boolean
language sql stable security definer as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'leader');
$$;

create policy "apk_shares_owner_or_leader" on apk_shares
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

create policy "projects_owner_or_leader" on projects
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

create policy "daily_reports_owner_or_leader" on daily_reports
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- Statuses stay shared/global across the whole team.
create policy "statuses_authenticated_only" on statuses
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Team roles + notifications (see migration-v10.sql for details/comments)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('leader', 'member')),
  last_seen_notifications_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "profiles_authenticated_all" on profiles
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

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
create policy "notifications_authenticated_all" on notifications
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table projects add column if not exists created_by_email text;
alter table projects add column if not exists updated_by_email text;
alter table daily_reports add column if not exists logged_by_email text;
alter table apk_shares add column if not exists logged_by_email text;
