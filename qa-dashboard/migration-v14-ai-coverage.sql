-- AI QA coverage pipeline upgrade
-- Run this once in Supabase SQL Editor after your existing migrations.

alter table if exists public.test_cases
  add column if not exists requirement_id text,
  add column if not exists scenario_type text,
  add column if not exists risk text,
  add column if not exists preconditions text,
  add column if not exists steps text,
  add column if not exists expected_result text,
  add column if not exists ai_generated boolean not null default false;

create index if not exists idx_test_cases_requirement_id
  on public.test_cases(requirement_id);

create index if not exists idx_test_cases_scenario_type
  on public.test_cases(scenario_type);

-- Stores the last AI analysis for traceability/coverage reporting.
create table if not exists public.ai_requirement_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null check (source_type in ('text','url')),
  source_url text,
  source_text text,
  project_summary text,
  requirements jsonb not null default '[]'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  high_risk_gaps jsonb not null default '[]'::jsonb,
  test_case_count integer not null default 0,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_requirement_runs_project
  on public.ai_requirement_runs(project_id, created_at desc);

alter table public.ai_requirement_runs enable row level security;

drop policy if exists "ai_runs_owner_or_leader" on public.ai_requirement_runs;
create policy "ai_runs_owner_or_leader" on public.ai_requirement_runs
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- Keep metadata flexible. Existing status/priority checks remain unchanged.
