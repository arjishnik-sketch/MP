-- 0008 — per-assignment ROLE label (source chart's role/qualifier column).
--
-- Purpose: the source charts print a role next to a person in the same row
--   (रायटर / ऑपरेटर), and the branch token next to station officers
--   ((तपास) / (प्रषा) / (गुन्हे)). Until now the seed folded that source column into
--   `notes_mr`, which is a DISPLAY-ONLY free-text field — so the renderer could only
--   echo it after the name instead of using it as the row label the source shows.
-- Current role: typed column for the source's role label; replaces the notes_mr
--   workaround for the 9 cells that carried one on the 10/09 chart.
-- Last meaningful change: 2026-10-11 — added (renderer fidelity work unit 1010).
-- Constraint/dependency: display label only — NEVER parsed for machine meaning
--   (same rule as notes_mr, AGENTS.md invariant 5). Nullable: most rows have no role.
--   Applied migrations are immutable; this file is additive only.

ALTER TABLE daily_assignments
  ADD COLUMN IF NOT EXISTS role_mr text;   -- source role/qualifier cell, display only

COMMENT ON COLUMN daily_assignments.role_mr IS
  'Source chart role label (रायटर, ऑपरेटर, (तपास) …) — display only, never parsed.';
