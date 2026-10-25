-- 0009_staff_profiles_and_rank_status.sql — forward-only.
-- Staff_Info.md documents a standing duty/assignment and weekly off for the
-- officer directory. These are master-profile facts, not chart assignments,
-- so they must survive independently of any one daily chart.
-- Ranks need the same deactivate-before-delete lifecycle as the other masters.

ALTER TABLE ranks
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT TRUE;

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS duty_assignment text,
  ADD COLUMN IF NOT EXISTS weekly_off text;
