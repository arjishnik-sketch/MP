-- 0004_immutability.sql — enforced immutability (ARCHITECTURE invariants 6, 10; §9 versioning).
-- 1) chart_versions is append-only: no UPDATE, no DELETE (finalized snapshots immutable).
-- 2) once a chart is FINALIZED its normalized working rows freeze; further edits must go
--    through a new draft (amendment). Only chart_versions inserts remain allowed there.

CREATE OR REPLACE FUNCTION chart_versions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'chart_versions is append-only (finalized snapshots are immutable); got % on chart_version %',
    TG_OP, OLD.chart_version_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chart_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON chart_versions
  FOR EACH ROW EXECUTE FUNCTION chart_versions_append_only();

CREATE OR REPLACE FUNCTION chart_freeze_when_finalized() RETURNS trigger AS $$
DECLARE
  l text;
BEGIN
  SELECT c.lifecycle INTO l FROM daily_charts c
   WHERE c.chart_id = COALESCE(NEW.chart_id, OLD.chart_id);
  IF l = 'FINALIZED' THEN
    RAISE EXCEPTION 'chart % is FINALIZED — snapshot only; amendments start a new draft (got % on %)',
      COALESCE(NEW.chart_id, OLD.chart_id), TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER freeze_assignments      BEFORE UPDATE OR DELETE ON daily_assignments         FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_availabilities   BEFORE UPDATE OR DELETE ON daily_availabilities      FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_loc_states       BEFORE UPDATE OR DELETE ON location_operational_states FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_notices          BEFORE UPDATE OR DELETE ON chart_notices             FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_scan_daily       BEFORE UPDATE OR DELETE ON scan_schedule_daily       FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_manpower         BEFORE UPDATE OR DELETE ON manpower_records          FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();
CREATE TRIGGER freeze_officer_summary  BEFORE UPDATE OR DELETE ON officer_summary_rows      FOR EACH ROW EXECUTE FUNCTION chart_freeze_when_finalized();

-- Lifecycle within a version round is monotonic DRAFT → VALIDATED → FINALIZED (invariant 9).
-- No AMENDED pseudo-state. The ONLY path back is the explicit amendment reopen
-- (FINALIZED → DRAFT), which never touches the frozen chart_versions snapshot.
CREATE OR REPLACE FUNCTION lifecycle_monotonic() RETURNS trigger AS $$
BEGIN
  IF NEW.chart_id <> OLD.chart_id OR NEW.chart_date <> OLD.chart_date THEN
    RAISE EXCEPTION 'chart identity is immutable (id/date cannot change)';
  END IF;
  IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
    IF NOT (OLD.lifecycle = 'DRAFT'     AND NEW.lifecycle IN ('VALIDATED','FINALIZED')
         OR OLD.lifecycle = 'VALIDATED' AND NEW.lifecycle = 'FINALIZED'
         OR OLD.lifecycle = 'FINALIZED' AND NEW.lifecycle = 'DRAFT') THEN
      RAISE EXCEPTION 'illegal lifecycle transition % → % (allowed: DRAFT→VALIDATED→FINALIZED, FINALIZED→DRAFT amendment reopen)',
        OLD.lifecycle, NEW.lifecycle;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_charts_lifecycle
  BEFORE UPDATE ON daily_charts
  FOR EACH ROW EXECUTE FUNCTION lifecycle_monotonic();
