-- Migration v6: APK sharing log
-- Run this in Supabase SQL Editor.

create table if not exists apk_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version text,
  apk_link text,
  shared_date date not null default current_date,
  shared_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_apk_shares_project on apk_shares(project_id);
create index if not exists idx_apk_shares_date on apk_shares(shared_date desc);

alter table apk_shares enable row level security;

drop policy if exists "apk_shares_authenticated_only" on apk_shares;
create policy "apk_shares_authenticated_only" on apk_shares
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
