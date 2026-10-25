-- 0001_masters.sql — Layer A: station master data (long-lived, chart-independent)
-- Forward-only. Never edit after applying; add 000N instead (AGENTS.md).
-- Invariants: staff deactivate never delete; marshal posts are LOCATIONS (kind=MARSHAL_POST)
-- so बंद+charge is first-class (DOMAIN.md three-fact distinction).

CREATE TABLE ranks (
  rank_code      text PRIMARY KEY,               -- protected token: SR_PI, PI, ... LPC
  name_mr        text NOT NULL,
  short_form_mr  text,                           -- e.g. वपोनि (display short form; full form on hover)
  cadre          text NOT NULL CHECK (cadre IN ('OFFICER','CONSTABULARY')),
  display_order  integer NOT NULL
);

CREATE TABLE staff_members (
  staff_id       bigserial PRIMARY KEY,
  name_mr        text NOT NULL,
  name_en        text,                           -- manual dual-entry (T10); transliteration assist is later
  rank_code      text NOT NULL REFERENCES ranks(rank_code),
  buckle_no      text,                           -- text: preserves source digits exactly
  phone          text,
  active         boolean NOT NULL DEFAULT TRUE   -- deactivate, never delete (invariant 12)
);

-- Buckled identities reconcile on rank+buckle; unbuckled on rank+name (old seed reconciliation rule).
CREATE UNIQUE INDEX staff_rank_buckle_uq ON staff_members(rank_code, buckle_no) WHERE buckle_no IS NOT NULL;
CREATE UNIQUE INDEX staff_rank_name_uq   ON staff_members(rank_code, name_mr);

CREATE TABLE locations (
  location_id    bigserial PRIMARY KEY,
  location_code  text NOT NULL UNIQUE,
  name_mr        text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('STATION','CHOWKI','MARSHAL_POST','OFFICE','COURT','FIXED_POINT')),
  display_order  integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT TRUE
);

CREATE TABLE units (
  unit_code      text PRIMARY KEY,               -- CR_MOBILE, DELTA_MOBILE, DB_MOBILE, CHOWKI_INCHARGE
  name_mr        text NOT NULL,
  unit_type      text NOT NULL CHECK (unit_type IN ('PATROL_MOBILE','CHOWKI_INCHARGE')),
  display_order  integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT TRUE
);

CREATE TABLE shifts (
  shift_code     text PRIMARY KEY,               -- DAY 09:00-21:00, NIGHT 21:00-09:00 (overnight → start date)
  title_mr       text NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  is_overnight   boolean NOT NULL
);

CREATE TABLE duty_definitions (
  duty_id        bigserial PRIMARY KEY,
  duty_code      text NOT NULL UNIQUE,
  title_mr       text NOT NULL,
  section_code   text,                           -- display grouping only: DAY_DEPLOYMENT / OFFICE / ... (not a page table)
  default_shift  text REFERENCES shifts(shift_code),
  location_id    bigint REFERENCES locations(location_id),
  display_order  integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT TRUE
);

CREATE TABLE scan_sessions (
  session_code   text PRIMARY KEY,               -- SCAN_MORNING / AFTERNOON / HOURLY / NIGHT
  title_mr       text NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  is_overnight   boolean NOT NULL,
  display_order  integer NOT NULL
);

-- Station-stable scan routing config (30 rows). chowki → patrol/marshal routing; hourly = window only.
CREATE TABLE scan_schedule_config (
  session_code     text NOT NULL REFERENCES scan_sessions(session_code),
  location_id      bigint NOT NULL REFERENCES locations(location_id),   -- chowki
  sequence         integer NOT NULL,
  start_time       time,
  end_time         time,
  patrol_unit_code text REFERENCES units(unit_code),
  marshal_location_id bigint REFERENCES locations(location_id),          -- marshal post = location
  PRIMARY KEY (session_code, sequence)
);
