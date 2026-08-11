-- Migration v7: project document link
-- Run this in Supabase SQL Editor.

alter table projects add column if not exists project_document text;
