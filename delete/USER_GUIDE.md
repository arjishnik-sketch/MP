<!--
Purpose: Plain-language operating guide for the current Panchavati Daily Duty site.
Current role: The only feature/workflow guide shipped with the deployable package.
Last meaningful change: 2026-10-19 — documented the connected Next, Fastify and PostgreSQL workflow.
Constraint: Describe the current UI honestly; unfinished actions are called out instead of implied.
-->

# Panchavati Daily Duty user guide

This guide explains the current site as it exists today. The application is a local station tool: the
Next screen talks to the local Fastify API, and Fastify reads and writes the single PostgreSQL database.
If the screen says that Fastify is unavailable, start the API and frontend with `npm run demo` from the
package root.

## 1. Start the site

From the package root:

```bash
npm ci
npm --prefix frontend ci
npm run db:setup
npm run demo
```

Open `http://localhost:3001/dashboard`. Use `npm run stop` when finished. The API at
`http://localhost:3100` is the data service; the normal clerk workflow is on port `3001`.
The current UI entry point is the Next dashboard. The old Fastify-rendered chart/mock/reference URLs
are not part of the current workflow.

## 2. Understand the three layers

The site shows three kinds of information:

1. **Station masters** — reusable ranks, staff, duties, locations/chowkis and units.
2. **A dated chart** — the people, seats, availability, notices and other facts for one date.
3. **Presentation** — how the dated facts are grouped and displayed on the screen.

Changing a staff master does not silently rewrite a dated assignment. Choosing a person in a chart seat
is a dated chart action. A finalized chart is read-only and represents a saved snapshot.

## 3. The application shell

The header stays visible while navigating.

### Station identity

Click the Maharashtra Police logo or station name to return to **Dashboard**.

### Theme button

The moon/sun control switches between light and dark themes. The choice is stored in this browser. It
does not change chart data. Current print colors follow the selected theme, but final print acceptance
is still part of the future layout/export pass.

### EN / MR control

The language control switches the available application chrome between English and Marathi. Operational
chart values, staff names, duty text and protected rank tokens remain source data and are not translated.
The main shell, dashboard, chart toolbar and assignment picker have the strongest current coverage.
Some management forms still contain English labels in the current build; do not treat this toggle as a
claim that every management string is already translated.

### Navigation groups

- **Dashboard** — selected-day overview, station directory and attendance facts.
- **Daily Duty Charts**
  - **Chart preview** — opens the local-day chart route.
  - **All Daily Duty Charts** — searchable archive of stored dates.
  - **Versions / templates** — disabled until version/template browsing is built.
  - **Import old chart** — disabled until import is built.
- **Manage Staff**
  - **Staff records** — staff master CRUD.
  - **Daily attendance** — date-scoped attendance records.
- **Master Data** — ranks, duties, locations/chowkis and units/mobiles.
- **Chart history** — a read-only date list; cross-chart search and version browsing are WIP.
- **Reports** — monthly reports are WIP.

Disabled items are deliberate. They are not partially working buttons.

## 4. Dashboard

The dashboard is an overview, not the full chart editor.

### What it shows

- The selected date and weekday.
- Whether a chart exists for that date and its lifecycle.
- The senior station officer and the available officer directory.
- Registered/current staff totals.
- Recorded present, default-present, weekly-off, recorded absent and unrecorded attendance facts.

The attendance counts distinguish a clerk-confirmed value from a profile/default value. A default is
not presented as a confirmed operational fact.

### Opening a day

When the dashboard is opened on the browser's local date, the app may create an **empty DRAFT chart**
for that date. This is idempotent: revisiting the day does not copy the previous chart or auto-assign
anyone. Historical dates are read-only from the dashboard and are fetched without creating a chart.

Use **Open today's chart** or **Open chart** to move to the chart workspace.

## 5. Chart archive and date selection

Open **Daily Duty Charts → All Daily Duty Charts** to see saved chart dates.

The archive supports:

- text search by date, weekday or lifecycle;
- weekday filtering;
- lifecycle filtering: Draft, Validated or Finalized;
- From and To date bounds;
- an **Open chart** action for each row.

The archive table is numbered. Its columns can be resized independently of the filter controls.

### Date menu in the chart toolbar

On a chart page, the date control opens a click-based menu. It contains:

- Today, Tomorrow and Yesterday shortcuts;
- saved chart dates;
- a search field;
- the date's weekday and lifecycle;
- disabled entries for dates with no saved chart;
- a search icon that opens the current history surface.

Use the arrow keys to move from the search field into the date options. Selecting a saved date changes
the route; it does not create a missing chart.

## 6. Chart workspace

Open a date at `/charts/YYYY-MM-DD` or use **Open chart** from the dashboard/archive.

The workspace is a continuous document made from the API's chart projection. Its current sections are:

1. command area with the senior officer and subordinate officer branches;
2. day and night station duties plus office duties;
3. six chowki blocks and their day/night content;
4. court, summons, warrant and special duties with scan schedule;
5. leave and other availability;
6. notices and officer register;
7. manpower matrix, shift summary, sudden-duty table, free tables and sign-off;
8. an event section when event data exists.

The screen preserves source ownership when a heading carries a location while following staff rows do
not carry that location themselves. A person should appear in one canonical home, not in every place the
source heading happens to describe.

### Toolbar controls

- **Version** currently shows the current chart. Version/template browsing is disabled.
- **Preview** shows the read-only document.
- **Edit** enables the current editing surfaces for a non-finalized chart.
- **Share** currently shows disabled Email and WhatsApp actions.
- **Export → PDF** opens the browser print dialog through `window.print()`.
- **Export → PNG** is marked Coming Soon.

For the current browser print path choose A4 landscape, enable background graphics and turn browser
headers and footers off. The React layout has not yet received final PDF pagination acceptance.

The edit control is disabled for a `FINALIZED` chart. The API also refuses finalized writes.

## 7. Editing an assignment seat

In Edit mode, click a person/seat in the chart. This opens the **Assign staff** dialog anchored to the
originating seat.

### Choose an existing staff member

1. Stay on **Choose existing**.
2. Type a name, buckle number or rank into the search field.
3. Optionally select a rank.
4. Click **Choose** beside the intended person.

The selected person is written to that exact dated assignment. Choosing a person resets that assignment's
`बिमा` flag to off; turn it on again explicitly if the source requires it.

### Clear a seat

Click **Clear to रिक्त**. The seat remains an explicit duty slot but has no person. Clearing does not
delete the duty definition or the assignment row.

### Set or remove `बिमा`

Use the **बिमा for this assignment** switch. It is available only when a person is present and applies
to that assignment only. It is never inferred from the duty title, notes or marshal text.

### Edit the current staff master

Switch to **Edit current staff** to change the current person's Marathi name, buckle number or phone.
The rank is shown but not changed in this dialog. Saving updates the reusable staff master; it does not
change the assignment's explicit `बिमा` value.

### Create and place a new staff member

1. Switch to **New staff**.
2. Enter the Marathi name and select a rank.
3. Optionally enter buckle number and phone.
4. Choose **Create and place**.

This is intentionally two writes: first a staff master is created, then it is placed in the selected
seat. If the first succeeds but placement cannot be confirmed, the dialog identifies the saved person and
offers **Retry placement**. Check the staff list before creating another record; do not create duplicates
to recover from a network error.

## 8. Editing a chowki or marshal location state

In Edit mode, each location shift can expose **Edit state** or **Set state**.

1. Open the state dialog for the location and shift.
2. Toggle the explicit `बंद` state if the place is closed for that shift.
3. If needed, select an explicit charge destination from the location list.
4. Choose **Save state**.

The state belongs to the location and shift, not to a person. It does not alter assignments. The editor
does not infer a charge destination from a note. If an existing state should disappear, use **Delete /
reset state**; the location becomes unconfigured for that shift.

The chart displays active/closed state and charge destination separately from `रिक्त` seats and `बिमा`
assignments.

## 9. Availability and leave rows

The **रजा व इतर उपलब्धता** section is separate from duty assignment. A person can have an availability
record without being removed from the staff master.

In Edit mode, expand **Edit availability rows**.

### Add a row

1. Choose **Add availability**.
2. Select an explicit staff member or leave it as `रिक्त`.
3. Enter the source category and optional group.
4. Enter date and/or time windows when the source has them.
5. Enter detail text exactly as it should be displayed.
6. Set the sort order and choose **Add row**.

The editor treats category and detail as display text. It does not parse them into operational meaning.

### Edit or delete a row

Use **Edit** beside a non-attendance row, change the fields and choose **Save row**. Use **Delete row**
only after confirming that the row is no longer needed. Attendance rows link back to the Daily Attendance
page so that one attendance action has one clear owner.

## 10. Notices

The **सूचना व निर्देश** section displays notices grouped by their stored group key.

In Edit mode, expand **Edit notices**:

- **Add notice** opens a group and text form;
- **Save notice** creates or updates the notice;
- **Delete** asks for confirmation and removes that notice.

Notice text is stored as typed display text. The current editor does not decide whether a notice belongs
to a particular chowki, shift or event.

## 11. Manpower matrix and structure editing

The manpower section preserves source cell values. A cell marked as derived is read-only; it must not be
overwritten by arithmetic performed in the browser.

In Edit mode, expand **Edit manpower values and columns**:

- edit a non-derived cell and leave the field to save it;
- choose **Add matrix column**, enter a label and add it;
- remove an added column after confirmation;
- inspect hidden/derived markers before assuming a blank is zero.

The current free-table editor also supports presentation-only extra tables:

- **Add table** creates a table with one column;
- change the title and leave the field to save it;
- **+ Row** adds a row;
- enter a column name and choose **+ Column**;
- edit column labels and individual cells, saving on blur;
- remove a row, column or whole table after confirmation.

These controls are useful structure primitives, but they are not yet the complete authoring system for
every source register.

## 12. Staff records

Open **Manage Staff → Staff records** for reusable staff data.

### Search and filter

The table can search name, rank, buckle, phone, standing duty and weekly-off text. Filter by:

- all, active or inactive staff;
- a specific rank.

The table has a serial-number column. Column boundaries can be dragged. A boundary can also be focused
with the keyboard:

- Arrow Left/Right changes width;
- Shift + Arrow changes it faster;
- Home/End use the minimum/maximum width;
- Enter or Space autofits to rendered content;
- double-click autofits with the mouse.

Widths are stored in this browser only and do not change database data.

### Add a staff member

Choose **+ Add staff**, enter the Marathi name and rank, then optionally add buckle number, phone,
documented duty and weekly off. Choose **Save staff**.

### Edit a staff member

Choose **Edit** in the row, change the fields and save. The rank can be changed through the form when the
API permits it. The chart's dated assignment remains a separate record.

### Deactivate, reactivate or delete

- **Deactivate** preserves chart history and removes the person from normal active choices.
- **Re-activate** makes the master available again.
- **Delete** requests a permanent delete. The API may reject deletion when another record still needs the
  staff member; deactivate instead when history or an assignment must remain intact.

Always prefer deactivation for a person who has appeared in a chart.

## 13. Daily attendance

Open **Manage Staff → Daily attendance**.

### Choose a date

The page starts on the browser's local date. Use the date field to inspect another date. Today can be
started automatically as an empty draft; a historical date is read-only until a chart is explicitly
started.

### Understand the rows

Each row shows the person, rank, buckle, weekly-off profile value, present checkbox, attendance state and
the source of that state.

- A default-present value is a projection, not a clerk confirmation.
- A known weekly off is shown distinctly.
- Checking **Present** saves a manual present exception.
- Unchecking saves an explicit absence; it is not the same as merely having no record.
- **Use default** deletes the manual exception and restores the profile/default projection.
- Other availability records are displayed as context and are not silently converted into attendance.

Every checkbox action is saved to PostgreSQL and refreshes the row result. Finalized charts show snapshot
attendance and are read-only.

## 14. Master Data

Open **Master Data** for station configuration. The page has tabs:

### Ranks

Create or edit a rank code, Marathi name, short form, cadre and display order. Deactivate/reactivate or
delete from the row actions. Rank codes are protected operational identifiers; do not casually rename a
code used by existing people.

### Duties

Create or edit duty code, Marathi title, section, default shift, optional location and display order.
The duty master describes reusable duty definitions; it does not itself place a person on a dated chart.

### Locations / Chowkis

Create or edit location code, Marathi name, kind and display order. Kinds include station, chowki,
marshal post, office, court and fixed point. The location master is not the same thing as a dated closed
state.

### Units / Mobiles

Create or edit unit code, Marathi name, type and display order. These are reusable unit choices for chart
records.

### Events / equipment

This tab is visible but marked **Coming Soon**. It is not a working event/equipment CRUD page yet.

The **Import (WIP)** button is also intentionally disabled.

## 15. History, reports and unfinished controls

**Chart history** lists stored dates with weekday and lifecycle and provides **Open chart**. It does not
yet edit or search across all chart versions.

**Reports** is a placeholder for monthly and future reports. No report is generated by the current
button.

On a chart, **Share → Email** and **Share → WhatsApp** are disabled. **Export → PNG** is disabled. The
current PDF menu item invokes the browser print dialog rather than silently generating a server PDF.

## 16. A practical current-day workflow

Use this sequence for the current connected build:

1. Start PostgreSQL, run `npm run demo`, and open Dashboard.
2. Confirm the dashboard date is the intended local date.
3. Open Daily Attendance and confirm explicit present/absent exceptions where required.
4. Open the chart for that date. It starts as an empty DRAFT if it did not exist.
5. Use the existing chart's Edit mode to replace available seats, clear seats to `रिक्त`, set explicit
   `बिमा`, and record location states, availability and notices.
6. Use Staff records and Master Data for reusable data that is missing instead of typing around a master
   record.
7. Review all sections in Preview mode. Check that no person, notice or explicit state was lost.
8. Use Export → PDF and the browser print settings for a local review copy.

This workflow is intentionally not described as a complete empty-to-full chart workflow yet. The missing
dated assignment/seat creation and remaining registers must be built before the clerk can construct every
source chart from zero using only the UI.

## 17. Operational meanings to protect

### `रिक्त`

An existing duty seat with no person. It is not a missing row and it is not a closed location.

### `बंद`

A location is explicitly closed for a shift. Its charge destination is a separate explicit field.

### `बिमा`

An explicit qualifier on a person-assignment. Selecting or replacing a person resets it so that the clerk
must opt in again.

The UI must never guess one of these facts from a Marathi note, a color, a person rank or a nearby label.

## 18. Common problems

### “Fastify service unavailable”

From the package root, run `npm run demo` or run `npm run dev` in one terminal and
`npm run dev:frontend` in another. Confirm port `3100` is reachable before judging a frontend page.

### “No chart is saved for this date”

The date was not created. Use today's empty-draft path or start the date explicitly where the page offers
that action. The date picker does not create charts just by selecting a missing date.

### A finalized chart cannot be edited

This is expected. Finalized charts are immutable snapshots. Use a future amendment/version workflow once
that UI is available; do not bypass the refusal by editing PostgreSQL directly.

### A staff choice looks wrong after a master edit

A master record and a dated assignment are separate. Refresh the chart and inspect the assignment's
current person. Do not create a duplicate staff member until the staff list and API response have been
checked.

### The page looks too wide or a table has moved

Management-table widths are browser-local. Use the resizer's double-click/Enter autofit, or clear the
site's local storage for the relevant table if a stale preference is the cause. This does not change
stored chart data.

## 19. What is coming next

The immediate product order is:

1. settle the real-data chart composition: main officer, three officers, day/night, compact supporting
   tables and a symmetric 3 × 2 chowki arrangement;
2. complete simple CRUD pages for all dated chart records so a clerk can go from empty to complete and
   back to empty;
3. add inline, Excel-like editing inside the chart without creating a shadow data model;
4. make the shared screen composition the accepted print/PDF/PNG source;
5. add event annexes and integrations only after the daily chart path is reliable.

The design must remain calm and form-like: one font, dark structural headings, lighter values, minimal
single borders, exact Marathi source text, no invented labels, no filler whitespace and no automatic
personnel decisions.
