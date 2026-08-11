-- Migration v15: expand test case categories
-- Run this in Supabase SQL Editor.

alter table test_cases drop constraint if exists test_cases_category_check;

alter table test_cases add constraint test_cases_category_check
  check (category in (
    'Functional', 'Positive', 'Negative', 'Edge Case', 'Security',
    'Validation', 'UI/UX', 'Performance', 'Accessibility',
    'Compatibility', 'Regression', 'UAT'
  ));
