-- Migration v2: editable statuses + project start date
-- Run this in Supabase SQL Editor (Project already set up with the original schema).
-- Safe to run once; uses IF NOT EXISTS / IF EXISTS guards.

-- 1. New table to hold editable status options
create table if not exists statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#12747D',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table statuses enable row level security;
-- No policies added on purpose (see supabase-schema.sql notes) — only
-- Netlify Functions using the service role key can read/write this table.

-- Seed the four original statuses if the table is empty
insert into statuses (name, color, sort_order)
select * from (values
  ('Not Started', '#6B7280', 0),
  ('In Progress', '#A9761E', 1),
  ('Blocked', '#A63D26', 2),
  ('Done', '#1F7A6C', 3)
) as seed(name, color, sort_order)
where not exists (select 1 from statuses);

-- 2. Projects: drop the old fixed-list constraint so any status name works,
-- and add a start_date column
alter table projects drop constraint if exists projects_status_check;
alter table projects add column if not exists start_date date;
