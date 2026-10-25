# Panchavati Daily Duty: Implementation Audit, User Guide & Chart-Fix Verification Report

**Date:** 19 October 2026  
**Repository Working Directory:** `D:\AI\Projects\Panchavati\DailyDutyPanchavati-ui-rebuild\new\Latest_Repo_Deployable_and_Updated\Latest_Repo_Deployable_and_Updated`  
**Database Server:** Local PostgreSQL 16 on `127.0.0.1:5432` (`panchavati3_dev` & `panchavati3_test`)  
**Services:** Root Fastify API on `:3100`, Next.js 15.5 on `:3001`  

---

## 1. Setup Instructions vs. Repository Status

| Setup Step in `README.md` | Documented Command | Repository Status & Verification Result | Discrepancy & Resolution |
|---|---|---|---|
| Dependency Installation (root) | `npm ci` | Verified. `node_modules` present, clean lockfile. | None. Root dependencies are intact. |
| Dependency Installation (frontend) | `npm --prefix frontend ci` | Verified. `frontend/node_modules` present. | None. Next.js 15.5 & React 19 dependencies intact. |
| Database Initialization & Migration | `npm run db:setup` | Runs `db:create`, `db:migrate`, `db:seed:reference`, `db:seed:chart`. Both `panchavati3_dev` and `panchavati3_test` have all 10 migrations applied and 24 tables present. | SCRAM authentication requires `$env:PGPASSWORD="<local-db-password>"` in local PowerShell session. |
| Application Startup | `npm run demo` | Starts `scripts/dev-all.mjs` supervising Fastify on `:3100` and Next.js on `:3001`. Frontend rewrites `/api/*` to Fastify `:3100`. | Documented entry point is `http://localhost:3001/dashboard`. Old server-rendered Fastify URLs are deprecated. |
| Diagnostics & Verification | `npm run doctor` | Verified with `$env:PGPASSWORD="<local-db-password>"; npm run doctor`. | 100% passed (Node 24.18, 10 migrations, 24 tables, template v1, seed counts sane, 10/09 chart present in both dev and test databases). |

---

## 2. User Guide Requirements & Expected Application Behaviour

The repository includes a dedicated [USER_GUIDE.md](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/USER_GUIDE.md) detailing the operational requirements and user flows:

1. **Three Layered Domain:**
   - **Station Masters:** Reusable ranks, staff members, duty definitions, locations/chowkis, and patrol units. Modifying a master record must never retroactively change historical dated assignments.
   - **Dated Chart:** Contains dated assignment seats, personnel placements, `बिमा` qualifiers, location operational states (`बंद` / charge destinations), scan schedule, availability records, notices, shift summaries, and sudden changes for one specific date.
   - **Presentation:** Semantic grouping for screen and print projection. Finalized charts are immutable snapshots; editing is disabled on finalized charts.

2. **Core Operational Invariants (Protected Meanings):**
   - **`रिक्त` (Vacant):** Indicates an explicit empty duty seat waiting for personnel assignment. It is never a missing row, and never a closed location.
   - **`बंद` (Closed):** An explicit operational state belonging to a location and shift, with an optional charge destination. It does not delete assignments or alter staff masters.
   - **`बिमा` (BIMA):** An explicit per-assignment qualifier. Choosing or replacing a staff member resets `बिमा` to false, requiring the clerk to opt in again explicitly. Never inferred from duty titles or remarks.
   - **No Auto-Scheduling or Inference:** Software never automatically assigns people or parses Marathi notes to guess operational facts. The clerk makes all personnel decisions explicitly.
   - **Single PostgreSQL Boundary:** Root PostgreSQL database holds all operational data. No shadow database or duplicate migration files inside `frontend/`.

3. **User Workflows Covered:**
   - **Dashboard (`/dashboard`):** Date selection, empty DRAFT creation for current day, station directory (Senior PI + branch officers), and attendance facts with profile vs. clerk-confirmed distinction.
   - **Chart Archive (`/charts`):** Text search, weekday filtering, lifecycle filtering (Draft, Validated, Finalized), date bounds, and navigation to dated charts.
   - **Chart Workspace (`/charts/[date]`):** Continuous document made from API projection. Edit mode enables seat assignment, seat creation/deletion, metadata editing, availability rows, notices, manpower matrix, scan rows, officer register, shift summaries, sudden duty changes, and special events.
   - **Staff Records (`/staff`):** Reusable staff master CRUD with keyboard-accessible resizable columns, rank/active filters, and guarded deactivation/deletion.
   - **Daily Attendance (`/staff/attendance`):** Date-scoped attendance exceptions with explicit present/absent states and reset-to-default.
   - **Master Data (`/master-data`):** Full CRUD for Ranks, Duties, Locations/Chowkis, Units/Mobiles.

---

## 3. Chart Fixes Documented in README.md: Analysis & Verification

The following table provides an exhaustive cross-reference of every chart-fix requirement discussed in `README.md` under *"Chart-layout feedback for the next design pass"*:

| # | Documented Requirement / Chart Issue | Relevant Source Files | Root Cause / Technical Context | Implementation Status | Verification Evidence |
|---|---|---|---|---|---|
| **1** | **Officer Hierarchy:**<br>Begin with the main/senior officer, then three subordinate officer positions beneath it. Number of officer rows configurable later, hierarchy immediately clear. | [chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx)<br>[chart-document-layout.ts](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/lib/chart-document-layout.ts)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | Command area requires top senior PI banner with support staff, followed by 3-column principal officer grid (गुन्हे, प्रशासन, तपास). | **Complete & Verified** | Centered `.senior-command` with `.senior-support` duty groups, followed by `.officer-command-grid` (3 columns). Clean typography and hierarchy. |
| **2** | **Command Area & Day/Night Grammar:**<br>Place day/night command area below the officer band. Day and night must use comparable visual grammar even if volumes differ. | [chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | Station duty columns must maintain symmetric column structure (`station-duty-columns`) with time ranges (०९:०० ते २१:००, २१:०० ते ०९:००) and balanced lanes. | **Complete & Verified** | 3-column station stack: Day shift, Night shift, and Office desks. Harmonized headers, timing badges, and identical borders. |
| **3** | **Chowkis 3 × 2 Grid & Beat-Marshal Divider:**<br>Treat the six chowkis as a clean 3 × 2 composition on wide screens and print. Ordinary chowki duty and beat-marshal duty separated without nested box look. | [chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | Previously 2 columns on screen; beat-marshal posts had nested borders causing visual box clutter. | **Complete & Verified** | `DocumentFlow columns={3} className="c1-chowkis"`, `@media print { .c1-chowkis { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }`. Beat-marshal styled with subtle dashed divider (`border-top: 1px dashed var(--line-soft)`). |
| **4** | **Chowki Officer in Header:**<br>If a chowki officer is present in source/header data, show that officer consistently above day/night staff rows even when night staff does not repeat the officer. Never manufacture a person where blank. | [chart-document-layout.ts](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/lib/chart-document-layout.ts)<br>[chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | In 10/09 chart, API officers were assigned to Day chowki rows (Katya Maruti, Karanja, Phulenagar), but Night rows had no officer. When rendered inside Day shift, the chowki header lacked officer identification, and symmetry was broken. | **Complete & Verified** | Extracted chowki officer from chowki rows into `block.officer`. Rendered in `.chowki-head` above day/night columns with `PersonCell` and timing. Excluded from Day shift rows to prevent duplication. For Malegaon, Sardar, and Meri (where source has no officer), `block.officer` remains null and nothing is manufactured. |
| **5** | **Visual Separation of `बिमा`, Closed State & Marshal Post:**<br>`बिमा`, marshal-post status, and chowki closure must remain visually separate facts. | [chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | `बिमा` is an assignment qualifier; `बंद` is a place fact; charge destination is a routing fact. | **Complete & Verified** | Distinct UI elements: `.bima-chip` on person cells, `.closed-tag` + `चार्ज → [चौकी]` on location state line, and separate `.marshal-state` inside `.marshal-block`. |
| **6** | **Typography & Weights:**<br>Use one readable Devanagari font throughout. Dark restrained treatment for headings, lighter normal-weight for staff and values. | [chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css)<br>[globals.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/globals.css) | Inconsistent font weights between headings and values can create clutter. | **Complete & Verified** | CSS variables `--chart-heading-weight: 700; --chart-value-weight: 400;`. Single Devanagari font stack. Headings use dark navy/ink-soft; staff values use normal weight. |
| **7** | **Calm, Form-like Design:**<br>Prefer clean divisions into 3-4 meaningful lanes over cards for every fact. No double borders, ornamental badges, emoji, or excessive whitespace. | [chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css)<br>[chart-workspace.tsx](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/components/chart-workspace.tsx) | Excessive card wrappers and emoji dilute the administrative police form aesthetic. | **Complete & Verified** | Clean multi-lane flow: 3 station lanes, 3-column chowkis, 2-column special duties, 2-column availability, 2-column officer register, 3-column scan schedule. Single borders only. |
| **8** | **Source Fidelity & No Silent Truncation:**<br>Real row counts and long Marathi labels must fit without clipping. Distinct headings (e.g. महिला and सायबर कक्ष) kept separate. | [chart-document-layout.ts](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/lib/chart-document-layout.ts)<br>[chart.css](file:///D:/AI/Projects/Panchavati/DailyDutyPanchavati-ui-rebuild/new/Latest_Repo_Deployable_and_Updated/Latest_Repo_Deployable_and_Updated/frontend/app/chart.css) | Marathi syllables and compound words wrap naturally and must not be hidden with `text-overflow: ellipsis`. Separate source desks must not be concatenated. | **Complete & Verified** | `overflow-wrap: anywhere;` and `white-space: normal;` on all duty titles and person cells. `DAY_WOMEN_DESK` and `DAY_CYBER` are separate duty groups. |

---

## 4. Verification Results & Command Outputs

The entire repository was validated against all compilation, type safety, database health, and runtime checks:

1. **Root TypeScript Check:**
   - Command: `npx tsc --noEmit`
   - Exit code: **0** (Clean)

2. **Frontend TypeScript Check:**
   - Command: `npm --prefix frontend run typecheck`
   - Exit code: **0** (Clean)

3. **Next.js Production Build:**
   - Command: `npm --prefix frontend run build`
   - Exit code: **0** (All 11 routes compiled and prerendered cleanly)

4. **Doctor Health Check:**
   - Command: `$env:PGPASSWORD="<local-db-password>"; npm run doctor`
   - Exit code: **0**
   - Results:
     - Node version: `24.18.0`
     - Migration files: `10` files present
     - `panchavati3_dev`: 10/10 applied, 0 pending, 0 checksum drift, 24 tables present, template v1, seed counts sane, 10/09 chart present
     - `panchavati3_test`: 10/10 applied, 0 pending, 0 checksum drift, 24 tables present, template v1, seed counts sane, 10/09 chart present

5. **Chowki Officer Extraction Verification on 10/09 Chart Data:**
   - काटया मारूती पोलीस चौकी: **हेमंत विजय मोहिते (API) 09:00:00-14:00:00** (Header officer rendered)
   - पंचवटी कारंजा पोलीस चौकी: **प्रशांत रामदास बोरसे (API) 16:00:00-21:00:00** (Header officer rendered)
   - फुलेनगर पोलीस चौकी: **शरद देविदास पाटील (API)** (Header officer rendered)
   - मालेगांव स्टॅड पोलीस चौकी: **None** (No officer in source; blank preserved)
   - सरदार पोलीस चौकी: **None** (No officer in source; blank preserved)
   - मेरी पोलीस चौकी: **None** (No officer in source; blank preserved)

---

## 5. Summary of Files Changed

| File Path | Nature of Change |
|---|---|
| `frontend/lib/chart-document-layout.ts` | Added `officer?: Assignment \| null` to `LocationBlock` interface; extracted chowki in-charge officer from source rows without duplicating in day staff. |
| `frontend/components/chart-workspace.tsx` | Updated `LocationBlockView` to render `.chowki-head` with chowki title and incharge officer badge/timing. |
| `frontend/app/chart.css` | Added styling for `.chowki-head`, `.chowki-incharge`, `.chowki-incharge-title`, and `.chowki-incharge-time`. |
| `audit.md` | Updated audit artifact with complete User Guide cross-reference, setup instructions, chart fixes status, and verification evidence. |
