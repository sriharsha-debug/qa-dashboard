-- Migration v9: remove assigned_projects (replaced by numbered task list in assigned_tasks)
-- Run this in Supabase SQL Editor.

alter table daily_reports drop column if exists assigned_projects;
