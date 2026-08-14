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

create table if not exists test_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'Not Run' check (status in ('Not Run', 'Pass', 'Fail', 'Blocked')),
  priority text default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  category text default 'Functional' check (category in (
    'Functional', 'Positive', 'Negative', 'Edge Case', 'Security',
    'Validation', 'UI/UX', 'Performance', 'Accessibility',
    'Compatibility', 'Regression', 'UAT'
  )),
  last_run_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_test_cases_project on test_cases(project_id);
alter table test_cases enable row level security;
create policy "test_cases_owner_or_leader" on test_cases
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
create policy "notifications_select_own_or_leader" on notifications
  for select
  using (actor_id = auth.uid() or is_team_leader());
create policy "notifications_insert_own" on notifications
  for insert
  with check (actor_id = auth.uid());
create policy "notifications_delete_own_or_leader" on notifications
  for delete
  using (actor_id = auth.uid() or is_team_leader());

alter table projects add column if not exists created_by_email text;
alter table projects add column if not exists updated_by_email text;
alter table daily_reports add column if not exists logged_by_email text;
alter table apk_shares add column if not exists logged_by_email text;


-- Migration v17: audit logs
-- Run this in Supabase SQL Editor after migration-v16.sql.
-- This adds an immutable-style change history for application data.

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name text not null,
  record_id uuid,
  record_label text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);
create index if not exists idx_audit_logs_table_name on audit_logs(table_name);
create index if not exists idx_audit_logs_actor_id on audit_logs(actor_id);

alter table audit_logs enable row level security;

drop policy if exists "audit_logs_leader_select" on audit_logs;
create policy "audit_logs_leader_select" on audit_logs
  for select
  using (is_team_leader());

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  actor_mail text;
  old_row jsonb;
  new_row jsonb;
  rid uuid;
  label text;
begin
  actor := auth.uid();
  actor_mail := coalesce(auth.jwt() ->> 'email', '');

  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    rid := new.id;
    label := coalesce(new_row->>'name', new_row->>'title', new_row->>'display_name',
                      new_row->>'email', new_row->>'version', new_row->>'message', rid::text);
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    rid := new.id;
    label := coalesce(new_row->>'name', new_row->>'title', new_row->>'display_name',
                      new_row->>'email', new_row->>'version', new_row->>'message', rid::text);
  else
    old_row := to_jsonb(old);
    rid := old.id;
    label := coalesce(old_row->>'name', old_row->>'title', old_row->>'display_name',
                      old_row->>'email', old_row->>'version', old_row->>'message', rid::text);
  end if;

  insert into audit_logs (
    actor_id, actor_email, action, table_name, record_id, record_label, old_data, new_data
  ) values (
    actor, actor_mail, tg_op, tg_table_name, rid, label, old_row, new_row
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_projects on projects;
create trigger audit_projects after insert or update or delete on projects
for each row execute function write_audit_log();

drop trigger if exists audit_daily_reports on daily_reports;
create trigger audit_daily_reports after insert or update or delete on daily_reports
for each row execute function write_audit_log();

drop trigger if exists audit_test_cases on test_cases;
create trigger audit_test_cases after insert or update or delete on test_cases
for each row execute function write_audit_log();

drop trigger if exists audit_apk_shares on apk_shares;
create trigger audit_apk_shares after insert or update or delete on apk_shares
for each row execute function write_audit_log();

drop trigger if exists audit_profiles on profiles;
create trigger audit_profiles after insert or update or delete on profiles
for each row execute function write_audit_log();
