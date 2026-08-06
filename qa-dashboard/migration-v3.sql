-- Migration v3: bugsheet link on projects
-- Run this in Supabase SQL Editor. Safe to run once.

alter table projects add column if not exists bugsheet text;
