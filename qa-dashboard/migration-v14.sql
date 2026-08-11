-- Migration v14: test case category (for coverage visibility)
-- Run this in Supabase SQL Editor.

alter table test_cases add column if not exists category text default 'Functional'
  check (category in ('Positive', 'Negative', 'Functional', 'Edge Case', 'End-to-End', 'Monkey'));
