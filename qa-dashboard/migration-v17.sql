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
