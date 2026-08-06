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
  name text not null,
  status text not null default 'Not Started',
  start_date date,
  bugsheet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  report_date date not null default current_date,
  project_manager text,
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
-- public "anon" key (safe to expose). These policies make sure only a
-- signed-in user (via Supabase Auth, email + password) can read or write
-- anything at all.
alter table projects enable row level security;
alter table daily_reports enable row level security;
alter table statuses enable row level security;

create policy "projects_authenticated_only" on projects
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "daily_reports_authenticated_only" on daily_reports
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "statuses_authenticated_only" on statuses
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
