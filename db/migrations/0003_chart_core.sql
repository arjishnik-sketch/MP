-- 0003_chart_core.sql — Layer B: daily chart working data (T13 hybrid model).
-- Normalized tables = editing source of truth while the chart is mutable.
-- At FINALIZE the complete ChartDocument is materialized into chart_versions.document_json;
-- reprints/PDF render from that snapshot only, never from today's master/template data.

CREATE TABLE daily_charts (
  chart_id               bigserial PRIMARY KEY,
  chart_date             date NOT NULL UNIQUE,        -- one chart per date (domain)
  lifecycle              text NOT NULL DEFAULT 'DRAFT'
                         CHECK (lifecycle IN ('DRAFT','VALIDATED','FINALIZED')),
  template_version_id    bigint NOT NULL REFERENCES template_versions(template_version_id),
  presentation_overrides jsonb NOT NULL DEFAULT '{}', -- "या तक्त्यासाठी" C-values live HERE (§5)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Immutable history. Append-only: UPDATE/DELETE blocked by trigger (0004).
CREATE TABLE chart_versions (
  chart_version_id     bigserial PRIMARY KEY,
  chart_id              bigint NOT NULL REFERENCES daily_charts(chart_id),
  version_no            integer NOT NULL,
  document_json         jsonb NOT NULL,               -- complete ChartDocument snapshot
  amended_from_version_id bigint REFERENCES chart_versions(chart_version_id),
  reason                text,                         -- amendment justification
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, version_no)
);

-- Assignments: person? + duty + location? + shift + typed windows + explicit BIMA/state.
CREATE TABLE daily_assignments (
  assignment_id    bigserial PRIMARY KEY,
  chart_id         bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  shift            text NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  duty_id          bigint REFERENCES duty_definitions(duty_id),
  duty_title_mr    text,                              -- rendered duty label when not from definitions
  location_id      bigint REFERENCES locations(location_id),
  unit_code        text REFERENCES units(unit_code),
  staff_id         bigint REFERENCES staff_members(staff_id),
  allocation_state text NOT NULL DEFAULT 'ALLOCATED'
                   CHECK (allocation_state IN ('ALLOCATED','VACANT_RIKT')),  -- invariant 1
  is_bima          boolean NOT NULL DEFAULT FALSE,    -- invariant 3: per-assignment boolean, never derived
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','NEEDS_ATTENTION')),
  source           text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','COPIED','REPLACED')),
  start_time       time,
  end_time         time,
  sort_order       integer NOT NULL DEFAULT 0,
  notes_mr         text,                              -- display only; NEVER parsed for machine meaning (invariant 5)
  -- रिक्त is a slot state, never a person:
  CONSTRAINT vacant_slot_has_no_person
    CHECK (allocation_state <> 'VACANT_RIKT' OR staff_id IS NULL),
  -- BIMA qualifies an actual person row:
  CONSTRAINT bima_requires_person
    CHECK (NOT is_bima OR staff_id IS NOT NULL)
);

CREATE INDEX daily_assignments_chart_idx ON daily_assignments(chart_id, shift, sort_order);
CREATE INDEX daily_assignments_staff_idx ON daily_assignments(staff_id);

-- Location operational state per chart+shift: बंद AND/OR charge destination (independent explicit facts).
-- Marshal posts are locations too, so marshal बंद+charge lives here — never parsed from notes.
CREATE TABLE location_operational_states (
  chart_id            bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  location_id         bigint NOT NULL REFERENCES locations(location_id),
  shift               text NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  is_closed           boolean NOT NULL DEFAULT FALSE,
  charge_destination_location_id bigint REFERENCES locations(location_id),
  PRIMARY KEY (chart_id, location_id, shift),
  CONSTRAINT charge_never_self
    CHECK (charge_destination_location_id IS NULL OR charge_destination_location_id <> location_id)
);

-- Availability (Layer B rows over Layer A staff): categories per DOMAIN list; typed windows only.
CREATE TABLE daily_availabilities (
  availability_id  bigserial PRIMARY KEY,
  chart_id         bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  staff_id         bigint NOT NULL REFERENCES staff_members(staff_id),
  category         text NOT NULL,                     -- साप्ताहिक सुट्टी, किरकोळ रजा, अर्जित रजा, सिक, गैरहजर, ...
  group_key        text,                              -- rendered column group (e.g. 'साप्ताहिक सुट्टी', 'इतर ड्युटी')
  window_start     date,                              -- typed; ranges and hourly windows both
  window_end       date,
  time_start       time,
  time_end         time,
  detail_mr        text,                              -- display suffix (08 ते 10), not parsed
  sort_order       integer NOT NULL DEFAULT 0
);
CREATE INDEX daily_availabilities_chart_idx ON daily_availabilities(chart_id);

-- Append-only sudden-change ledger (कारण मीमांसा).
CREATE TABLE sudden_duty_changes (
  change_id          bigserial PRIMARY KEY,
  chart_id           bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  seq                integer NOT NULL,
  original_staff_id  bigint REFERENCES staff_members(staff_id),
  replacement_staff_id bigint REFERENCES staff_members(staff_id),
  detail_mr          text NOT NULL,
  note_mr            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, seq)
);

-- Ordered chart notices (night directives, event notices; optional event link — SME N2).
CREATE TABLE chart_notices (
  notice_id    bigserial PRIMARY KEY,
  chart_id     bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  group_key    text,
  sort_order   integer NOT NULL DEFAULT 0,
  text_mr      text NOT NULL
);
CREATE INDEX chart_notices_chart_idx ON chart_notices(chart_id, sort_order);

-- Scan schedule daily rows (config is station-stable; daily person rows are chart data).
CREATE TABLE scan_schedule_daily (
  scan_row_id   bigserial PRIMARY KEY,
  chart_id      bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  session_code  text NOT NULL REFERENCES scan_sessions(session_code),
  sequence      integer NOT NULL,
  start_time    time,
  end_time      time,
  staff_id      bigint REFERENCES staff_members(staff_id),
  note_mr       text
);
CREATE INDEX scan_schedule_daily_chart_idx ON scan_schedule_daily(chart_id);

-- Manpower matrix: rank × status cells. Stored authoritative values (never auto-reconciled, N4/N5).
CREATE TABLE manpower_records (
  chart_id    bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  row_key     text NOT NULL,                          -- row label key (साप्ताहिक सुट्टी, हजर मनुष्यबळ, ...)
  column_key  text NOT NULL,                          -- PI, API, ..., OFFICE, ME, TOTAL
  value_text  text NOT NULL,                          -- display value verbatim (.., 04, 12<br>04 ...)
  is_derived  boolean NOT NULL DEFAULT FALSE,         -- D-rule: derived values are never editable
  PRIMARY KEY (chart_id, row_key, column_key)
);

-- Officer duty summary rows (15 subordinate officers; override-capable — N10).
CREATE TABLE officer_summary_rows (
  chart_id     bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  row_no       integer NOT NULL,
  officer_text text NOT NULL,                          -- display name (source spelling preserved)
  duty_text    text NOT NULL,
  source       text NOT NULL DEFAULT 'SOURCE' CHECK (source IN ('SOURCE','SUGGESTION','OVERRIDE')),
  PRIMARY KEY (chart_id, row_no)
);

-- Shift summary totals (source shows blank for 10/09 — kept representable).
CREATE TABLE shift_summary_cells (
  chart_id    bigint NOT NULL REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  summary_key text NOT NULL,                           -- DAY / NIGHT / OTHER
  column_key  text NOT NULL,                           -- अधिकारी / अंमलदार / महिला अंमलदार / एकूण
  value_text  text NOT NULL,
  PRIMARY KEY (chart_id, summary_key, column_key)
);

-- Special events (annex pages at print; schema does not change when packet grows a page).
CREATE TABLE special_events (
  event_id    bigserial PRIMARY KEY,
  chart_id    bigint REFERENCES daily_charts(chart_id) ON DELETE CASCADE,
  title_mr    text NOT NULL,
  event_date  date NOT NULL,
  start_time  time,
  venue_mr    text,
  fall_in_mr  text
);

CREATE TABLE event_assignments (
  event_assignment_id bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES special_events(event_id) ON DELETE CASCADE,
  staff_id    bigint REFERENCES staff_members(staff_id),
  role_mr     text,
  sort_order  integer NOT NULL DEFAULT 0
);
