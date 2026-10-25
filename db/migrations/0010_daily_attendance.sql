-- Purpose: Reserve a typed, exception-only attendance namespace in daily_availabilities.
-- Current role: One manual day/person fact, whole-day typed categories, immutable when finalized.
-- Last meaningful change: 2026-10-18 — attendance integrity without another operational table.
-- Constraint: No existing personnel/default rows are inserted, changed, or backfilled.
-- ChartDocument already snapshots these availability rows, including the namespace/category.
-- Defaults (present / staff weekly-off profile) are not persisted facts or historical snapshots.
-- Rollback: drop the trigger/function, index and constraint below; availability rows are retained.

ALTER TABLE daily_availabilities
  ADD CONSTRAINT daily_attendance_typed_exception CHECK (
    group_key IS DISTINCT FROM 'attendance:v1'
    OR (staff_id IS NOT NULL AND category IN ('उपस्थित', 'गैरहजर')
        AND window_start IS NULL AND window_end IS NULL
        AND time_start IS NULL AND time_end IS NULL)
  );

CREATE UNIQUE INDEX daily_attendance_person_uq
  ON daily_availabilities (chart_id, staff_id) WHERE group_key = 'attendance:v1';

-- Existing availability freeze triggers cover UPDATE/DELETE. Attendance also needs INSERT
-- protection and both sides of a namespace/chart move. A chart lock serializes with finalize.
CREATE FUNCTION daily_attendance_freeze() RETURNS trigger AS $$
DECLARE
  chart_lifecycle text;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.group_key = 'attendance:v1' THEN
    SELECT lifecycle INTO chart_lifecycle FROM daily_charts
      WHERE chart_id = OLD.chart_id FOR SHARE;
    IF chart_lifecycle = 'FINALIZED' THEN
      RAISE EXCEPTION 'chart % is FINALIZED — attendance is immutable; use amendment', OLD.chart_id;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.group_key = 'attendance:v1' THEN
    SELECT lifecycle INTO chart_lifecycle FROM daily_charts
      WHERE chart_id = NEW.chart_id FOR SHARE;
    IF chart_lifecycle = 'FINALIZED' THEN
      RAISE EXCEPTION 'chart % is FINALIZED — attendance is immutable; use amendment', NEW.chart_id;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_attendance_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON daily_availabilities
  FOR EACH ROW EXECUTE FUNCTION daily_attendance_freeze();
