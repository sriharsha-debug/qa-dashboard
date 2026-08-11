-- Migration v5: expanded project tracking fields
-- Run this in Supabase SQL Editor.

alter table projects add column if not exists end_date date;
alter table projects add column if not exists project_manager text;
alter table projects add column if not exists kt_date date;
alter table projects add column if not exists ui_testing_start_date date;
alter table projects add column if not exists ui_testing_end_date date;
alter table projects add column if not exists functional_testing_start_date date;
alter table projects add column if not exists functional_testing_end_date date;
alter table projects add column if not exists mobile_app_developers text;
alter table projects add column if not exists web_developers text;
alter table projects add column if not exists backend_developers text;
alter table projects add column if not exists clients_review text;
alter table projects add column if not exists sign_off_date date;
alter table projects add column if not exists remarks text;
