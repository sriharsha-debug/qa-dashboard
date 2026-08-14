-- Migration v18: Bugs per project
-- Run this in Supabase SQL Editor after migration-v17.sql.
--
-- Adds a "Bugs" module scoped to each project (separate from the UI/Functionality
-- bug *counts* already on daily_reports). Each bug record includes a required
-- "page" field — the screen/page/module the bug was found on.

create table if not exists bugs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  page text not null,
  description text,
  severity text not null default 'Medium' check (severity in ('Low', 'Medium', 'High', 'Critical')),
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Fixed', 'Retest', 'Closed', 'Reopened')),
  reported_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bugs_project on bugs(project_id);

alter table bugs enable row level security;

drop policy if exists "bugs_owner_or_leader" on bugs;
create policy "bugs_owner_or_leader" on bugs
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());

-- Include bugs in the same audit-log trail as everything else.
drop trigger if exists audit_bugs on bugs;
create trigger audit_bugs after insert or update or delete on bugs
for each row execute function write_audit_log();
