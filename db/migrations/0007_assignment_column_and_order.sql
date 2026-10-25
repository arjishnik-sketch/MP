-- 0007_assignment_column_and_order.sql
-- What the schema cannot express (no view can derive it):
--   1) daily_assignments rows carry shift + sort_order, but sort_order restarts per
--      source column stack (Table 1/2 col 1..4), so (shift, sort_order) is ambiguous —
--      the chart's duty-column identity is missing and cannot be inferred from any
--      stored value. Required for no-loss ChartDocument projection (R-01/R-02).
--      This is content structure of the source chart, NOT page geometry.
--   2) manpower_records PK is (chart_id, row_key, column_key) with no display order;
--      row_key is arbitrary Marathi text, so alphabetical order is wrong (मंजूर must
--      precede हजर मनुश्यबळ). Required for no-loss matrix rendering (R-04).
--
-- Affected invariants: none change meaning (1-12 unaffected); supports R-01/R-02/R-04.
-- Rollback (reversible, new columns only — apply as 0008 if ever needed; never edit this file):
--   ALTER TABLE daily_assignments DROP COLUMN column_no;
--   ALTER TABLE manpower_records DROP COLUMN display_order;
-- Existing rows: both columns get DEFAULT (1 / 0) — technically valid but semantically
-- wrong for the seeded 10/09 chart; corrected by re-running the DRAFT chart seed
-- (wipe-and-reseed). Never applied to FINALIZED charts (freeze trigger + seed refusal).
-- API/projection shape: new ChartDocument projection only; no existing endpoint.

ALTER TABLE daily_assignments
  ADD COLUMN column_no integer NOT NULL DEFAULT 1
  CHECK (column_no >= 1);

ALTER TABLE manpower_records
  ADD COLUMN display_order integer NOT NULL DEFAULT 0;
