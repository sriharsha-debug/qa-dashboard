-- Migration v29: project_knowledge table (Knowledge Base tab)
-- Run this in Supabase SQL Editor after migration-v28.sql.
--
-- Backs the new "Knowledge Base" tab: per-project training content
-- (requirements, functionality notes, flows) split up by which
-- application it belongs to (e.g. User App, Vendor App, Admin Panel,
-- Sub Admin Panel, or any custom name you type in). Every AI prompt the
-- dashboard/automation builds for that project — bug-detail generation
-- and test-case generation — automatically pulls this in as context,
-- so replies are grounded in your real app instead of generic guesses.

create table if not exists project_knowledge (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  app_segment text not null default 'Common / Cross-App',
  doc_type text not null default 'Requirement',
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_knowledge_project on project_knowledge(project_id);
create index if not exists idx_project_knowledge_segment on project_knowledge(project_id, app_segment);

alter table project_knowledge enable row level security;

create policy "project_knowledge_owner_or_leader" on project_knowledge
  for all
  using (owner_id = auth.uid() or is_team_leader())
  with check (owner_id = auth.uid() or is_team_leader());
