<!--
Purpose: User-facing setup and project-status guide for the clean Panchavati handoff.
Current role: The only setup document shipped with the deployable package.
Last meaningful change: 2026-10-19 — documented the standalone API, database and Next handoff.
Constraint: This package has one PostgreSQL boundary; the frontend must not get a second database copy.
-->

# Panchavati Daily Duty

Panchavati Daily Duty is a local-first web application for preparing and reviewing the daily duty chart
of **Panchavati Police Station, Nashik City**. It is designed for one clerk who makes every personnel
choice explicitly. The software stores the station data, renders the chart, flags problems and provides
editing tools; it never chooses or replaces a person automatically.

## What this handoff contains

This is a self-contained application package. It includes the parts required to run the current site:

```text
PostgreSQL
   ↑
root db/ migrations and seeds
   ↑
root Fastify API :3100
   ↑  /api rewrites
Next frontend :3001  →  http://localhost:3001/dashboard
```

The `db/` directory belongs beside the API, not inside the frontend. That is intentional. Copying a
second database directory into `frontend/` would create two migration and seed owners and eventually
cause drift. The frontend is a client of the API; the API is the only application data boundary.

The handoff contains no external repository, archived application, design reference, screenshot, local
database file, dependency directory, credential or runtime cloud service. Install dependencies locally
with the lockfiles supplied in the root and `frontend/`.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL 16 or 17 running locally for the normal development workflow
- Windows, macOS or Linux with a shell that can run the commands below

No API key, hosted AI service, CDN or external transliteration service is required. The application uses
the local PostgreSQL instance and the local dependency tree.

## First-time local setup

Run these commands from this directory:

```bash
npm ci
npm --prefix frontend ci
npm run db:setup
npm run demo
```

Then open:

```text
http://localhost:3001/dashboard
```

This is the current application UI. Port `3100` is the Fastify/API service; do not use its old
server-rendered chart, frozen mock or legacy-reference URLs as the main site entry point.

`npm run demo` starts both services:

- Fastify API: `http://localhost:3100`
- Current Next frontend: `http://localhost:3001`

Press **Ctrl+C** in the demo terminal to stop both. If a process was left behind, run:

```bash
npm run stop
```

### PostgreSQL setup

The default local connection expects the PostgreSQL server at `127.0.0.1:5432`, user `postgres`, with
trust authentication or a password supplied by `PGPASSWORD`. `npm run db:setup` creates and prepares:

- `panchavati3_dev` for the running application
- `panchavati3_test` for source-side verification when the full source repository is available

Useful connection variables are:

```text
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<local-password-if-needed>
PANCHAVATI_DEV_DB=panchavati3_dev
PANCHAVATI_TEST_DB=panchavati3_test
```

For a managed PostgreSQL instance, set `DATABASE_URL`. The API uses the database named by that URL when
the local database-name variables have not been deliberately pinned. Do not put a password in a tracked
file.

### Running the services separately

Use two terminals when debugging one side independently:

```bash
# terminal 1
npm run dev

# terminal 2
npm run dev:frontend
```

The frontend rewrites browser requests from `/api/*` to Fastify. If Fastify is on another address,
create `frontend/.env.local` from `frontend/.env.example` and set:

```text
FASTIFY_URL=http://127.0.0.1:3100
```

The normal local ports can be changed for the API with `PORT`; keep the frontend rewrite and the API
address aligned when doing so.

## Current state

The current site is a working connected vertical slice, not a finished chart-authoring product.

### Working now

- Next.js shell with Panchavati identity, dashboard and grouped navigation
- Date-aware dashboard with station directory, chart lifecycle and attendance facts
- Chart archive and date filters
- Current chart workspace built from the API's `ChartDocument`, not a frontend-only fixture
- Preview/edit mode boundary; finalized charts are read-only in the editor
- Explicit assignment picker with search and rank filter
- Clear a seat to `रिक्त`, select an existing person, or create a staff master and place that person
- Edit the selected staff member's master fields
- Explicit per-assignment `बिमा` toggle
- Explicit location state editor for active/closed state and charge destination
- Availability row add, edit and delete with typed dates, times, staff, category, detail and order
- Notice add, edit and delete
- Manpower matrix value editing for non-derived cells and added matrix columns
- Basic free-table structure editing: add/delete tables, rows and columns, edit labels and cells
- Dated assignment/seat authoring: add new seats (`+ जागा जोडा`), edit seat timing/role/unit/notes metadata, and safely delete vacant seats
- Complete registers authoring in Edit mode:
  - Scan schedule hourly rows add, edit and delete
  - Officer duty summary rows add, edit and delete
  - Shift summary counts and metrics put/edit and delete
  - Sudden duty changes record, edit and delete
  - Special events and per-event personnel assignments add, edit and delete
- Chowki 3 × 2 grid composition for desktop and print with clean beat-marshal top dividers (no nested box look)
- Staff master CRUD with search, rank/status filters, deactivate/reactivate and guarded deletion
- Station master CRUD for ranks, duties, locations/chowkis and units/mobiles
- Date-scoped attendance with explicit present/absent choices, weekly-off defaults and reset-to-default
- Light/dark theme persistence and the available English/Marathi chrome switch
- Local browser print entry from the chart export menu

### Honest current gaps

Equipment / arms register persistence, historical chart version comparison/branching, PNG raster export, external messaging hooks (email/WhatsApp), monthly reports and legacy spreadsheet importers remain marked as planned follow-ups.

The print/export stylesheet continues to be refined for exact paper density and symmetry on physical printouts. The current UI now provides complete connected authoring for all chart sections, registers, and seats without requiring raw database queries.

## Data rules that must survive every change

- The clerk chooses all personnel. Never add an auto-scheduler or silent replacement.
- `रिक्त` means an existing empty seat. `बंद` means a location is closed and may have a charge
  destination. `बिमा` is an explicit per-assignment qualifier. They are three different facts.
- Never infer operational meaning by parsing Marathi notes or remarks.
- Finalized charts are immutable snapshots. An amendment is a new version; copying a previous chart must
  never change the source chart.
- PostgreSQL is the single source of stored operational data. Physical pages are render output.
- Preserve every source row and value. Marathi wraps; it must not be silently truncated.
- Keep protected tokens and canonical spellings exact, including `CCTNS`, `Dial 112 MERS`, `DB`, `MERS`,
  `TOTAL`, `Office`, `ME`, rank codes, `बिमा` and `पोशि`.

## Near-term product plan

The work should proceed in this order:

1. **Fix and agree on the chart layout using the real 10/09 data.** Plan the whole chart from top to
   bottom before polishing isolated cards. The print result must be dense, symmetric and easy to read in
   a photograph of paper.
2. **Build simple management CRUD pages first.** Make staff, ranks, duties, locations/chowkis, units,
   dated seats and the remaining registers addable, readable, editable and deletable outside the chart
   page. The clerk must be able to start with an empty chart and assemble a real day without hidden
   database work.
3. **Add inline chart CRUD.** After the management path is reliable, add Excel-like in-place editing for
   seats, rows, columns, labels, notices, officer/support records and other chart blocks. Every mutation
   must remain explicit, narrow and reversible where appropriate.
4. **Make screen and print one design.** The final optimized React chart should be the same composition
   that is printed or exported. Keep machine checks for row completeness, page fit and Marathi wrapping.
5. **Add event annexes and other deferred features** only after the everyday chart workflow is complete.

## Chart-layout feedback for the next design pass

These are the owner's current design priorities, not a permission to invent missing source data:

- Begin with the main/senior officer, then the three subordinate officer positions beneath it. The
  number of officer rows should remain configurable later, but the hierarchy should be immediately clear.
- Place the day/night command area below the officer band. Day and night should use comparable visual
  grammar even when their data volumes differ.
- Treat the six chowkis as a clean 3 × 2 composition when the available width supports it. Inside each
  chowki, distinguish the ordinary chowki duty and the beat-marshal duty without making the block look
  like nested boxes inside boxes.
- If a chowki officer is present in the source/header data, show that officer consistently above the
  day/night staff rows even when the night staff list does not repeat the officer. Do not manufacture a
  person where the source is blank.
- Keep `बिमा`, marshal-post status and chowki closure visually separate. A blue source marking is a clue
  to inspect, not a reason to infer a new operational field.
- Use one readable Devanagari font throughout. Use a dark restrained treatment for chart headings and
  column names, and a lighter normal-weight treatment for staff and ordinary values.
- Prefer clean divisions into three or four meaningful lanes over a card for every fact. Avoid double
  borders, ornamental badges, emoji, generic dashboard tiles, excessive rounded boxes and decorative
  whitespace.
- Use the real row counts and real long labels when judging geometry. The small design fixture looked
  efficient because it omitted data; it is not a safe layout benchmark.
- Spend unused page height on larger type and line spacing before adding filler. If a seventh sheet is
  needed for an event or for legibility, preserve the information instead of shrinking it into an
  unreadable photograph.
- Keep source concepts distinct. For example, do not merge a source that separately says **महिला** and
  **सायबर कक्ष** into one invented label. Exact source text wins over a convenient combined heading.
- The chart should feel like a calm, efficient station form: consistent alignment, predictable labels,
  clear day/night boundaries and no AI-generated visual clutter.

## Deployment note

The included `render.yaml` Blueprint provisions the complete stack on Render:
1. **Managed PostgreSQL** (`panchavati-demo-db`)
2. **Fastify Backend API** (`daily-duty-panchavati-api`) with automated migrations and seed data
3. **Next.js Frontend UI** (`daily-duty-panchavati-ui`) automatically wired to the Fastify API via `FASTIFY_URL`

For a friend's local handoff, `npm run demo` remains the supported one-command path.

Do not publish real station data or credentials without the station's explicit approval. Keep database
backups, `.env` files and local operational exports outside version control.
