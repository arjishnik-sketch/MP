-- 0005_availability_nullable.sql — forward-only.
-- Table 3 of the source shows categories with no personnel under them
-- (e.g. "हायकोर्ट - मुंबई" on 10/09). That is information: the category exists,
-- nobody is listed. Representing it needs a staff-less availability row, so
-- daily_availabilities.staff_id becomes nullable. Person-bearing rows are unaffected.

ALTER TABLE daily_availabilities ALTER COLUMN staff_id DROP NOT NULL;
