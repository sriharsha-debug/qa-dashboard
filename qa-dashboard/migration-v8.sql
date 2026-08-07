-- Migration v8: assigned projects + assigned tasks on daily reports
-- Run this in Supabase SQL Editor.

alter table daily_reports add column if not exists assigned_projects text;
alter table daily_reports add column if not exists assigned_tasks text;
