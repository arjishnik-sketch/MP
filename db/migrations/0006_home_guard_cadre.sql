-- 0006_home_guard_cadre.sql — forward-only.
-- The 10/09 source names five "होम <number> <surname>" identities (night कारंजा list
-- and काळाराम गार्ड). "होम" is its own identity form with its own number series — evidence,
-- not invention — so the ranks.cadre CHECK gains HOME_GUARD as a third cadre.
-- The 16 police rank codes themselves are untouched.

ALTER TABLE ranks DROP CONSTRAINT IF EXISTS ranks_cadre_check;
ALTER TABLE ranks ADD CONSTRAINT ranks_cadre_check
  CHECK (cadre IN ('OFFICER','CONSTABULARY','HOME_GUARD'));
