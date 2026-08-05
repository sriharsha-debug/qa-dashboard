-- ==========================
-- QA Dashboard Database Schema
-- ==========================

create extension if not exists pgcrypto;

-------------------------------------------------------
-- Statuses
-------------------------------------------------------

create table if not exists statuses (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    color text not null default '#12747D',
    sort_order integer not null default 0,
    created_at timestamptz default now()
);

insert into statuses (name, color, sort_order)
values
('Not Started','#6B7280',0),
('In Progress','#A9761E',1),
('Blocked','#A63D26',2),
('Done','#1F7A6C',3)
on conflict (name) do nothing;

-------------------------------------------------------
-- Projects
-------------------------------------------------------

create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    status text not null default 'Not Started',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Add missing columns if table already exists
alter table projects
add column if not exists start_date date;

alter table projects
add column if not exists status text default 'Not Started';

alter table projects
add column if not exists created_at timestamptz default now();

alter table projects
add column if not exists updated_at timestamptz default now();

-------------------------------------------------------
-- Daily Reports
-------------------------------------------------------

create table if not exists daily_reports (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    report_date date default current_date,
    project_manager text,
    bugsheet text,
    test_cases integer default 0,
    ui_bugs integer default 0,
    functionality_bugs integer default 0,
    remarks text,
    sign_off boolean default false,
    notes text,
    created_at timestamptz default now()
);

-------------------------------------------------------
-- Indexes
-------------------------------------------------------

create index if not exists idx_daily_reports_project
on daily_reports(project_id);

create index if not exists idx_daily_reports_date
on daily_reports(report_date desc);

-------------------------------------------------------
-- Row Level Security
-------------------------------------------------------

alter table projects enable row level security;
alter table daily_reports enable row level security;
alter table statuses enable row level security;

-------------------------------------------------------
-- Reload Schema Cache
-------------------------------------------------------

notify pgrst, 'reload schema';