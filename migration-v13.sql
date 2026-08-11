-- Migration v13: test execution tracker
-- Run this in Supabase SQL Editor.

create table if not exists test_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'Not Run' check (status in ('Not Run', 'Pass', 'Fail', 'Blocked')),
  priority text default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  last_run_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_test_cases_project on test_cases(project_id);

alter table test_cases enable row level security;

drop policy if exists "test_cases_owner_or_leader" on test_cases;
create policy "test_cases_owner_or_leader" on test_cases
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());
