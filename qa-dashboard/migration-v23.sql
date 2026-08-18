-- Migration v23: Reported Date and Closing Date on bugs
-- Run this in Supabase SQL Editor after migration-v22.sql.
--
-- Adds two plain date columns so testers can track when a bug was reported
-- and when it was closed, separate from the created_at/updated_at
-- timestamps (which move whenever any field changes). Both are nullable,
-- so this is safe to run without touching any existing bug rows.

alter table bugs add column if not exists reported_date date;
alter table bugs add column if not exists closed_date date;
