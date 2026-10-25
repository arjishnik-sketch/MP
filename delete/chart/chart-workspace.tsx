"use client";

/**
 * Purpose: Semantic, editable duty document from the complete ChartDocument.
 * Current role: One screen/print component flow with one home for every assignment.
 * Last meaningful change: 2026-10-18 — approved C1 flow, correct source homes and split registers.
 * Constraint: Personnel choices remain explicit; finalized documents remain read-only.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { apiDelete, apiFetch, apiPatch, apiPost } from "@/lib/api";
import type {
  Assignment,
  Availability,
  ChartDocument,
  EventRecord,
  FreeTable,
  Location,
  Notice,
  OfficerRow,
  Person,
  ScanRow,
  Shift,
  ShiftSummary,
  StructureOverrides,
  SuddenChange,
} from "@/lib/types";
import { compactPersonLabel, displayDateTime, localDateIso, personLabel } from "@/lib/format";
import { splitRegister, textLines, writerBranchForRole } from "@/lib/document-flow";
import { DocumentFlow, type FlowItem } from "@/components/document-flow";
import { ensureDailyDraft } from "@/lib/daily-start";
import { useLocale } from "@/lib/i18n";
import { rankExpansion } from "@/lib/rank-label";
import { ATTENDANCE_GROUP } from "@/lib/attendance";
import {
  buildDocumentLayout, chartDateLabel, devanagari, displayText, isPersonSlot, records, shifts, windowLabel,
  type DutyGroup, type LocationBlock,
} from "@/lib/chart-document-layout";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { AssignmentEditor } from "@/components/assignment-editor";
import { ChartToolbar } from "@/components/chart-toolbar";
import { AvailabilityEditor, LocationStateEditor, type LocationStateTarget } from "@/components/continuation-editors";
import {
  AddSeatDialog,
  ScanRowDialog,
  OfficerSummaryDialog,
  ShiftSummaryDialog,
  SuddenChangeDialog,
  EventDialog,
} from "@/components/register-editors";

type StructureOp = Record<string, unknown>;
type EditProps = {
  editMode: boolean;
  onSelect: (assignment: Assignment) => void;
  onAddSeat?: (group: DutyGroup) => void;
};
type LocationEditProps = EditProps & { onEditState: (target: LocationStateTarget) => void };

function shiftLabel(shift: Shift): string {
  return shift === "DAY" ? "दिवसपाळी" : "रात्रपाळी";
}

function ChartRankHelp({ person }: { person: Person }) {
  const { locale } = useLocale();
  const abbreviation = person.rankShortFormMr || person.rankCode;
  return <span className="chart-rank-help" tabIndex={0} aria-label={abbreviation}>
    {devanagari(abbreviation)}
    <span className="chart-rank-tooltip" role="tooltip" lang={locale}>{rankExpansion(person, locale)}</span>
  </span>;
}

function PersonCell({ person, assignment, editMode = false, onSelect }: {
  person: Person | null; assignment?: Assignment; editMode?: boolean; onSelect?: (assignment: Assignment) => void;
}) {
  const compact = person ? devanagari(compactPersonLabel(person)) : "";
  const abbreviation = person ? devanagari(person.rankShortFormMr || person.rankCode) : "";
  const fullLabel = person ? devanagari(personLabel(person)) : "रिक्त";
  const body = <>{assignment?.isBima && <span className="bima-chip">बिमा</span>}{person
    ? <span className="person-value"><ChartRankHelp person={person} /> <span>{compact.slice(abbreviation.length).trimStart()}</span></span>
    : <span className="vacant-tag">रिक्त</span>}</>;
  if (!assignment || !editMode || !onSelect) return <span className="person-label" data-full-name={person?.nameMr}>{body}</span>;
  return <button type="button" className="assignment-button" onClick={() => onSelect(assignment)} aria-label={`संपादन: ${fullLabel}`}>{body}</button>;
}

function Section({ title, count, children, id, className = "" }: {
  title: string; count?: number; children: ReactNode; id?: string; className?: string;
}) {
  return (
    <section id={id} className={`chart-section ${className}`.trim()}>
      <h2>{title}{typeof count === "number" && <span className="section-count">{devanagari(count)}</span>}</h2>
      <div className="section-body">{children}</div>
    </section>
  );
}

function DocumentHeader({ chart }: { chart: ChartDocument }) {
  const title = displayText(chart.template.labels["head.h1"]) || "नाशिक शहर पोलीस आयुक्तालय";
  const subtitle = displayText(chart.template.labels["head.h2"]) || "दैनिक कर्तव्य वाटप";
  const labels = chart.template.overrides.labels as Record<string, unknown> | undefined;
  return <header className="chart-title-lines">
    <strong className="chart-title-line chart-title-line-heading">{displayText(labels?.["head.h1"]) || title}</strong>
    <span className="chart-title-line chart-title-line-heading">{displayText(labels?.["head.h2"]) || subtitle}</span>
    <time className="chart-title-line chart-title-line-value" dateTime={chart.chartDate}>{chartDateLabel(chart.chartDate)}, {chart.weekdayMr}</time>
  </header>;
}

function AssignmentLine({ row, editMode, onSelect, title, headingField, identityOnHeading = false }: EditProps & {
  row: Assignment; title?: string; headingField?: DutyGroup["sourceHeadingField"]; identityOnHeading?: boolean;
}) {
  const slot = isPersonSlot(row);
  const timing = windowLabel(row.startTime, row.endTime);
  const note = headingField === "notesMr" ? null : row.notesMr;
  const dutyLabel = !headingField && !row.labelFromDuty && row.dutyTitleMr !== title ? row.dutyTitleMr : null;
  const roleLabel = row.roleMr && row.roleMr !== title && row.roleMr !== dutyLabel ? row.roleMr : null;
  const hasMeta = timing || row.unit || note || row.status === "NEEDS_ATTENTION";
  if (!slot && !dutyLabel && !roleLabel && !hasMeta) {
    return identityOnHeading ? null : <span hidden aria-hidden="true" data-assignment-id={row.assignmentId} />;
  }
  const sourceText = [row.dutyTitleMr, row.roleMr, row.source, `स्तंभ ${row.columnNo}`].filter(Boolean).join(" | ");
  return (
    <div
      className={`document-assignment ${slot ? "person-slot" : "source-line"}`}
      data-assignment-id={identityOnHeading ? undefined : row.assignmentId}
      data-column={row.columnNo}
      data-source={row.source}
      title={sourceText}
    >
      {slot ? <>
        {row.roleMr && row.roleMr !== title && <span className="assignment-role">{row.roleMr}</span>}
        <PersonCell person={row.person} assignment={row} editMode={editMode} onSelect={onSelect} />
      </> : <>
        {dutyLabel && <span className="source-label">{dutyLabel}</span>}
        {roleLabel && <span>{roleLabel}</span>}
      </>}
      {hasMeta && <span className="assignment-meta">
        {timing && <span>{timing}</span>}
        {row.unit && <span>{row.unit.nameMr}</span>}
        {note && <span className="cell-pre">{note}</span>}
        {row.status === "NEEDS_ATTENTION" && <span className="needs-attention">लक्ष आवश्यक</span>}
      </span>}
    </div>
  );
}

function DutyGroupView({ group, editMode, onSelect, onAddSeat, compact = false, split = false, hideHeading = false, inlineShift = false }: EditProps & { group: DutyGroup; compact?: boolean; split?: boolean; hideHeading?: boolean; inlineShift?: boolean }) {
  const headingRow = group.sourceHeading ?? group.rows.find((row) => !isPersonSlot(row) && row.dutyTitleMr === group.title && !row.notesMr);
  const rows = group.rows.filter((row) => row !== headingRow);
  const parts = splitRegister(rows, split && rows.filter(isPersonSlot).length > 5 ? 2 : 1);
  const headingLabel = compact && group.rows[0]?.dutyCode === "OFFICE_WRITER" ? "रायटर" : group.title;
  return (
    <section className={`duty-group ${compact ? "is-compact" : ""}`} data-duty-group={group.key}>
      <h4 className={hideHeading ? "c1-source-heading" : undefined} aria-hidden={hideHeading || undefined} title={group.title} data-assignment-id={headingRow?.assignmentId}>
        <span className="duty-group-heading-label">{headingLabel}</span>
        {inlineShift && group.sourceHeadingField !== "notesMr" && headingLabel !== shiftLabel(group.shift) && <span className="duty-group-shift-label">{shiftLabel(group.shift)}</span>}
      </h4>
      <div className="duty-group-body">
        {headingRow && <AssignmentLine row={headingRow} title={group.title} headingField={group.sourceHeadingField ?? "dutyTitleMr"} identityOnHeading editMode={editMode} onSelect={onSelect} />}
        <div className={`duty-register-parts ${parts.length > 1 ? "is-split" : ""}`}>
          {parts.map((part, index) => <div className={`duty-group-people ${part.length >= 4 ? "is-dense-grid" : ""}`.trim()} key={index}>
            {part.map((row) => <AssignmentLine key={row.assignmentId} row={row} title={group.title} editMode={editMode} onSelect={onSelect} />)}
          </div>)}
        </div>
        {editMode && onAddSeat && (
          <div className="no-print pt-1">
            <button
              type="button"
              className="text-xs text-muted hover:text-navy underline cursor-pointer"
              onClick={() => onAddSeat(group)}
            >
              + जागा जोडा
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function groupHasContent(group: DutyGroup): boolean {
  return group.rows.some((row) => isPersonSlot(row) || row.startTime || row.endTime || row.unit || row.status === "NEEDS_ATTENTION"
    || (row !== group.sourceHeading && (row.notesMr || row.roleMr || (row.labelFromDuty === false && row.dutyTitleMr !== group.title))));
}

function groupWeight(group: DutyGroup): number {
  return 2 + group.rows.reduce((height, row) => height + (row.person ? 1 : 0) + textLines(row.notesMr) / 2, 0);
}

function DutyGroups({ groups, editMode, onSelect, onAddSeat, compact = false, parentTitle, inlineShift = false }: EditProps & { groups: DutyGroup[]; compact?: boolean; parentTitle?: string; inlineShift?: boolean }) {
  const ordered = [...groups.filter(groupHasContent), ...groups.filter((group) => !groupHasContent(group))];
  return <>{ordered.map((group) => <DutyGroupView key={group.key} group={group} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact={compact} hideHeading={group.title === parentTitle} inlineShift={inlineShift} />)}</>;
}

function LocationShift({ block, shift, editMode, onSelect, onEditState, onAddSeat }: LocationEditProps & { block: LocationBlock; shift: Shift }) {
  const state = block.states.find((candidate) => candidate.shift === shift);
  const groups = block.groups.filter((group) => group.shift === shift);
  return (
    <div className={`location-shift ${state?.isClosed ? "is-closed" : ""}`}>
      <h4 className="location-shift-title">{shift === "DAY" ? "दिवसपाळी" : "रात्रपाळी"}</h4>
      {state && <div className="location-state-line">
        {state.isClosed ? <span className="closed-tag">बंद</span> : <span className="active-state">सक्रिय</span>}
        {state.chargeTo && <span>चार्ज → {state.chargeTo.nameMr}</span>}
      </div>}
      {editMode && <div className="location-state-actions no-print">
        <span>{state ? (state.isClosed ? "Explicit बंद" : "Explicit active") : "No explicit state"}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onEditState({ location: block.location, shift, state })}>{state ? "Edit state" : "Set state"}</Button>
      </div>}
      <DutyGroups groups={groups} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact parentTitle={block.location.nameMr} />
      {block.marshals.map((marshal) => {
        const marshalState = marshal.states.find((item) => item.shift === shift);
        return <div key={marshal.location.locationId} className="marshal-block">
          <h5>{marshal.location.nameMr}</h5>
          {(marshalState || editMode) && <div className={`marshal-state ${marshalState ? "" : "no-print"}`.trim()}>
            {marshalState && <>{marshalState.isClosed ? <span className="closed-tag">बंद</span> : <span className="active-state">सक्रिय</span>}{marshalState.chargeTo && <span>चार्ज → {marshalState.chargeTo.nameMr}</span>}</>}
            {editMode && <Button type="button" size="sm" variant="outline" className="no-print" onClick={() => onEditState({ location: marshal.location, shift, state: marshalState })}>{marshalState ? "Edit state" : "Set state"}</Button>}
          </div>}
          <DutyGroups groups={marshal.groups.filter((group) => group.shift === shift)} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact parentTitle={marshal.location.nameMr} />
        </div>;
      })}
    </div>
  );
}

function LocationBlockView({ block, editMode, onSelect, onEditState, onAddSeat }: LocationEditProps & { block: LocationBlock }) {
  const timing = block.officer ? windowLabel(block.officer.startTime, block.officer.endTime) : "";
  return (
    <article className="chowki-block">
      <div className="chowki-head">
        <h3>{block.location.nameMr}</h3>
        {block.officer && (
          <div className="chowki-incharge">
            <span className="chowki-incharge-title">अधिकारी:</span>
            <PersonCell person={block.officer.person} assignment={block.officer} editMode={editMode} onSelect={onSelect} />
            {timing && <span className="chowki-incharge-time">{timing}</span>}
          </div>
        )}
      </div>
      <div className="location-shifts">
        {shifts.map((shift) => (
          <LocationShift key={shift} block={block} shift={shift} editMode={editMode} onSelect={onSelect} onEditState={onEditState} onAddSeat={onAddSeat} />
        ))}
      </div>
    </article>
  );
}

function CommandDocument({ chart, editMode, onSelect, onEditState, onAddSeat, onSaved }: LocationEditProps & { chart: ChartDocument; onSaved: () => void }) {
  const layout = useMemo(() => buildDocumentLayout(chart), [chart]);
  const stationColumns = shifts.map((shift) => ({ shift, groups: layout.station.filter((group) => group.shift === shift) }));
  const writerKeys = layout.principals.map((officer) => writerBranchForRole(officer.assignment?.roleMr, officer.branch));
  const unambiguousWriters = new Set(writerKeys).size === writerKeys.length;
  const supportRoles = new Set(["रायटर", "चालक", "RTPC", "ऑपरेटर"]);
  const sourceSupportGroups = layout.specialDuties.filter((group) => group.columnNo === 9
    && group.rows.every((row) => row.columnNo === 9)
    && group.rows.some((row) => supportRoles.has(row.roleMr ?? "")));
  const supportGroupKeys = new Set(sourceSupportGroups.map((group) => group.key));
  const seniorSupport = [...layout.seniorSupport, ...sourceSupportGroups];
  // Contradictory duplicate source roles must not duplicate or lose a writer seat.
  // Keep the branch registers separate rather than choosing which person owns them.
  const separateWriters = unambiguousWriters ? [] : [...layout.writerGroups.values()].flat();
  const specialItems: FlowItem[] = [
    ...layout.specialDuties.filter((group) => !supportGroupKeys.has(group.key) && groupHasContent(group)).map((group) => ({
       key: group.key, weight: groupWeight(group) / (group.rows.filter(isPersonSlot).length > 5 ? 1.5 : 1),
       content: <div className="special-duty-block"><DutyGroupView group={group} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact split inlineShift /></div>,
     })),
    ...layout.specialLocations.map((block) => ({
      key: block.location.code, weight: Math.max(...shifts.map((shift) => block.groups.filter((group) => group.shift === shift).reduce((sum, group) => sum + groupWeight(group), 2))),
      content: <LocationBlockView block={block} editMode={editMode} onSelect={onSelect} onEditState={onEditState} onAddSeat={onAddSeat} />,
    })),
  ];

  return <>
    <article className="chart-sheet command-sheet" lang="mr" data-document-section="command">
      <DocumentHeader chart={chart} />
      <section className="senior-command" aria-label="ठाणे प्रमुख">
        <div className="senior-command-heading">
          {layout.senior ? <div className="command-identity"><AssignmentLine row={layout.senior} title={layout.senior.roleMr || undefined} editMode={editMode} onSelect={onSelect} /></div> : <span className="command-value" title="वरिष्ठ पोलीस निरीक्षक">नियुक्ती नाही</span>}
          <span className="command-role">{layout.senior?.roleMr || "ठाणे प्रमुख"}</span>
        </div>
        {seniorSupport.length > 0 && <div className="senior-support"><DutyGroups groups={seniorSupport} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact inlineShift /></div>}
      </section>
      <div className="officer-command-grid">
        {layout.principals.map((officer, index) => <section className="officer-command" key={officer.branch}>
          <div className="officer-command-heading">
            {officer.assignment ? <div className="command-identity"><AssignmentLine row={officer.assignment} title={officer.assignment.roleMr || undefined} editMode={editMode} onSelect={onSelect} /></div> : <span className="command-value" title="पोलीस निरीक्षक">नियुक्ती नाही</span>}
            <span className="command-role">{officer.assignment?.roleMr || officer.branch}</span>
          </div>
          {unambiguousWriters && <DutyGroups groups={layout.writerGroups.get(writerKeys[index]) ?? []} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact />}
        </section>)}
      </div>
      <div className="station-duty-columns">
        {stationColumns.map(({ shift, groups }) => <section className="station-duty-column" key={shift}>
          <h3>{shift === "DAY" ? "दिवसपाळी कर्तव्य" : "रात्रपाळी कर्तव्य"}<span>{shift === "DAY" ? "०९:०० ते २१:००" : "२१:०० ते ०९:००"}</span></h3>
          <DutyGroups groups={groups} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} />
        </section>)}
        <section className="station-duty-column office-duty-column">
          <h3>कार्यालयीन शाखा व कारकून</h3>
          <DutyGroups groups={[...layout.officeCore, ...separateWriters]} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} />
        </section>
      </div>
    </article>

    <article className="chart-sheet" lang="mr" data-document-section="chowki">
      <DocumentHeader chart={chart} />
      <Section id="chowkis" title="पोलीस चौक्या">
        {layout.chowkis.length ? <DocumentFlow columns={3} className="c1-chowkis" items={layout.chowkis.map((block) => ({
          key: block.location.code,
          weight: Math.max(...shifts.map((shift) => [...block.groups, ...block.marshals.flatMap((marshal) => marshal.groups)].filter((group) => group.shift === shift).reduce((sum, group) => sum + groupWeight(group), 2))),
          content: <LocationBlockView block={block} editMode={editMode} onSelect={onSelect} onEditState={onEditState} onAddSeat={onAddSeat} />,
        }))} /> : <p className="document-empty">नियुक्ती नोंद नाही</p>}
      </Section>
    </article>

    <article className="chart-sheet" lang="mr" data-document-section="special-duties">
      <DocumentHeader chart={chart} />
      <Section title="कोर्ट, समन्स, वॉरंट व विशेष कक्ष">
        <DocumentFlow columns={2} className="c1-special-flow" items={specialItems} />
        <div className="c1-header-only-groups" aria-label="नोंद नसलेली शीर्षके">
          {layout.specialDuties.filter((group) => !supportGroupKeys.has(group.key) && !groupHasContent(group)).map((group) => <DutyGroupView key={group.key} group={group} editMode={editMode} onSelect={onSelect} onAddSeat={onAddSeat} compact />)}
        </div>
        {!specialItems.length && !layout.specialDuties.length && <p className="document-empty">नोंद नाही</p>}
      </Section>
      <ScanSection date={chart.chartDate} chart={chart} editMode={editMode} onSaved={onSaved} />
    </article>
  </>;
}

function AvailabilitySection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editorRow, setEditorRow] = useState<Availability | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const groups = new Map<string, ChartDocument["availability"]>();
  for (const row of chart.availability) {
    const key = `${row.groupKey || ""}|${row.category}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const groupItems: FlowItem[] = [...groups.entries()].map(([key, rows]) => {
    const parts = splitRegister(rows, rows.length >= 8 ? 2 : 1);
    return {
      key, weight: 3 + rows.reduce((sum, row) => sum + 1 + textLines(row.detailMr) / 2, 0) / parts.length,
      content: <section className="availability-group" data-availability-group={key}>
        <h3>{rows[0].category}</h3>
        {rows[0].groupKey && rows[0].groupKey !== rows[0].category && <p className="register-group-label">{rows[0].groupKey === ATTENDANCE_GROUP ? "दैनंदिन हजेरी" : rows[0].groupKey}</p>}
        <div className={`c1-roster-parts ${parts.length > 1 ? "is-split" : ""}`}>
          {parts.map((part, index) => <div key={index}>{part.map((row) => <div className="availability-row" key={row.availabilityId} data-availability-id={row.availabilityId}>
            {row.person && <PersonCell person={row.person} />}
            {(row.windowStart || row.windowEnd) && <span>{[row.windowStart, row.windowEnd].filter(Boolean).map((value) => devanagari(value!)).join(" ते ")}</span>}
            {(row.timeStart || row.timeEnd) && <span>{windowLabel(row.timeStart, row.timeEnd)}</span>}
            {row.detailMr && <span className="cell-pre">{row.detailMr}</span>}
          </div>)}</div>)}
        </div>
      </section>,
    };
  });
  const defaultSortOrder = chart.availability.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
  const openAdd = () => {
    setEditorRow(null);
    setEditorOpen(true);
  };
  const openEdit = (row: Availability) => {
    setEditorRow(row);
    setEditorOpen(true);
  };
  return <Section title="रजा व इतर उपलब्धता" count={chart.availability.length}>
    <DocumentFlow columns={2} className="c1-availability" items={groupItems} />
    {!chart.availability.length && <p className="document-empty">नोंद नाही</p>}
    {editMode && <details className="document-edit-panel no-print">
      <summary>Edit availability rows</summary>
      <div className="availability-admin-toolbar">
        <p className="form-hint">Every row keeps its explicit staff, category, group, typed windows, detail text, and sort order.</p>
        <Button type="button" size="sm" variant="outline" onClick={openAdd}>+ Add availability</Button>
      </div>
      <div className="availability-admin-list">
        {chart.availability.map((row) => <div className="availability-admin-row" key={row.availabilityId}>
          <div className="availability-admin-summary">
            <strong>{row.person ? personLabel(row.person) : "रिक्त"}</strong>
            <span>{row.category}{row.groupKey ? `, ${row.groupKey === ATTENDANCE_GROUP ? "दैनंदिन हजेरी" : row.groupKey}` : ""}</span>
            {(row.windowStart || row.windowEnd || row.timeStart || row.timeEnd) && <span>{[row.windowStart, row.windowEnd].filter(Boolean).join(" ते ")}{row.timeStart || row.timeEnd ? `, ${[row.timeStart, row.timeEnd].filter(Boolean).join(" ते ")}` : ""}</span>}
            {row.detailMr && <span className="cell-pre">{row.detailMr}</span>}
            <small>sort {row.sortOrder}</small>
          </div>
          {row.groupKey === ATTENDANCE_GROUP
            ? <Link className="row-action" href={`/staff/attendance?date=${date}`}>Edit attendance</Link>
            : <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Button>}
        </div>)}
        {chart.availability.length === 0 && <p className="document-empty">नोंद नाही. Add an explicit availability row when needed.</p>}
      </div>
    </details>}
    <AvailabilityEditor
      date={date}
      row={editorRow}
      open={editorOpen}
      defaultSortOrder={defaultSortOrder}
      onOpenChange={setEditorOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function NoticeEditor({ date, notice, onSaved }: { date: string; notice?: Notice; onSaved: () => void }) {
  const [text, setText] = useState(notice?.textMr ?? "");
  const [group, setGroup] = useState(notice?.groupKey ?? "सूचना");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setText(notice?.textMr ?? ""); setGroup(notice?.groupKey ?? "सूचना"); }, [notice]);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true); setError("");
    try {
      if (notice) await apiPatch(`/api/charts/${date}/notices/${notice.noticeId}`, { text, group });
      else await apiPost(`/api/charts/${date}/notices`, { text, group });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save notice"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!notice || !window.confirm("Delete this notice?")) return;
    setBusy(true); setError("");
    try { await apiDelete(`/api/charts/${date}/notices/${notice.noticeId}`); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete notice"); }
    finally { setBusy(false); }
  };
  return <div className="notice-editor">
    <input value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Notice group" placeholder="Group" />
    <textarea value={text} onChange={(event) => setText(event.target.value)} aria-label="Notice text" placeholder="Notice text" />
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => void save()}>{notice ? "Save notice" : "Add notice"}</Button>{notice && <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>Delete</Button>}</div>
    {error && <span role="alert" className="status-line error">{error}</span>}
  </div>;
}

function NoticesSection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [adding, setAdding] = useState(false);
  const groups = new Map<string, Notice[]>();
  chart.notices.forEach((notice) => groups.set(notice.groupKey || "सूचना", [...(groups.get(notice.groupKey || "सूचना") ?? []), notice]));
  return <Section id="notices" title="सूचना व निर्देश" count={chart.notices.length}>
    <DocumentFlow items={[...groups.entries()].map(([group, notices]) => ({
      key: group, weight: 2 + notices.reduce((sum, notice) => sum + textLines(notice.textMr), 0),
      content: <section className="notice-group"><h3>{group}</h3>{notices.map((notice) => <p key={notice.noticeId} data-notice-id={notice.noticeId} className="cell-pre">{notice.textMr}</p>)}</section>,
    }))} />
    {!chart.notices.length && <p className="document-empty">नोंद नाही</p>}
    {editMode && <details className="document-edit-panel no-print">
      <summary>Edit notices</summary>
      <Button size="sm" variant="outline" onClick={() => setAdding((value) => !value)}>+ Add notice</Button>
      {adding && <NoticeEditor date={date} onSaved={() => { setAdding(false); onSaved(); }} />}
      <div className="notice-edit-grid">{chart.notices.map((notice) => <NoticeEditor key={notice.noticeId} date={date} notice={notice} onSaved={onSaved} />)}</div>
    </details>}
  </Section>;
}

function MatrixSection({ chart, editMode, onStructureOp }: { chart: ChartDocument; editMode: boolean; onStructureOp: (op: StructureOp) => Promise<void> }) {
  const structure = (chart.template.overrides.structure as StructureOverrides | undefined) ?? {};
  const columns = [...(chart.template.layout.matrixColumns ?? []), ...(structure.matrix?.addedColumns ?? [])];
  for (const cell of chart.manpower) if (!columns.some((column) => column.key === cell.columnKey)) columns.push({ key: cell.columnKey, label: cell.columnKey });
  const rows = [...new Set(chart.manpower.map((cell) => cell.rowKey))];
  for (const key of Object.keys(structure.matrix?.cells ?? {})) {
    const [rowKey, columnKey] = key.split("|");
    if (!rows.includes(rowKey)) rows.push(rowKey);
    if (!columns.some((column) => column.key === columnKey)) columns.push({ key: columnKey, label: columnKey });
  }
  const value = (rowKey: string, columnKey: string) => structure.matrix?.cells?.[`${rowKey}|${columnKey}`]
    ?? chart.manpower.find((cell) => cell.rowKey === rowKey && cell.columnKey === columnKey)?.valueText ?? "";
  const plainCell = (valueText: string) => valueText.replace(/<br\s*\/?>/gi, "\n");
  return <Section id="manpower" title="मनुष्यबळ स्थिती दर्शक मॅट्रिक्स">
    <div className="table-wrap"><table className="data-table manpower-matrix"><thead><tr><th>तपशील</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
      {rows.map((rowKey) => <tr key={rowKey}><th>{rowKey}</th>{columns.map((column) => {
        const cell = chart.manpower.find((candidate) => candidate.rowKey === rowKey && candidate.columnKey === column.key);
        return <td key={column.key} data-matrix-cell={`${rowKey}|${column.key}`} title={cell?.isDerived ? "Derived value" : undefined}><span className="cell-pre">{devanagari(plainCell(value(rowKey, column.key)))}</span></td>;
      })}</tr>)}
    </tbody></table></div>
    {editMode && <details className="document-edit-panel no-print"><summary>Edit manpower values and columns</summary>
      <div className="table-wrap"><table className="data-table matrix-editor"><thead><tr><th>Row</th>{columns.map((column) => <th key={column.key}>{column.label}{structure.matrix?.hiddenColumns?.includes(column.key) && <Badge tone="outline">Hidden in saved layout</Badge>}{structure.matrix?.addedColumns?.some((item) => item.key === column.key) && <Button size="sm" variant="danger" onClick={() => { if (window.confirm(`Delete the added column ${column.label}?`)) void onStructureOp({ op: "matrix.column.remove", key: column.key }); }}>Remove</Button>}</th>)}</tr></thead><tbody>
        {rows.map((rowKey) => <tr key={rowKey}><th>{rowKey}</th>{columns.map((column) => {
          const cell = chart.manpower.find((candidate) => candidate.rowKey === rowKey && candidate.columnKey === column.key);
          const current = value(rowKey, column.key);
          const editableText = plainCell(current).replaceAll("\n", " / ");
          return <td key={`${column.key}-${current}`}>{cell?.isDerived ? <span>{editableText} <small>derived</small></span> : <input className="matrix-value-input" defaultValue={editableText} onBlur={(event) => { if (event.target.value !== editableText) void onStructureOp({ op: "matrix.cell", key: `${rowKey}|${column.key}`, text: event.target.value }); }} aria-label={`${rowKey} ${column.label}`} />}</td>;
        })}</tr>)}
      </tbody></table></div>
      <Button size="sm" variant="outline" onClick={() => { const label = window.prompt("New matrix column label"); if (label?.trim()) void onStructureOp({ op: "matrix.column.add", label: label.trim() }); }}>+ Add matrix column</Button>
    </details>}
  </Section>;
}

function ShiftSummarySection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editingSummary, setEditingSummary] = useState<ShiftSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const columns = [...new Set([...(chart.template.layout.shiftSummaryColumns ?? []), ...chart.shiftSummaries.map((row) => row.columnKey)])];
  const summaries: Array<"DAY" | "NIGHT" | "OTHER"> = chart.shiftSummaries.length ? [...new Set(chart.shiftSummaries.map((row) => row.summaryKey))] : ["DAY", "NIGHT", "OTHER"];
  return <Section title="पाळीनिहाय सारांश" count={chart.shiftSummaries.length}>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>पाळी</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{summaries.map((summary) => <tr key={summary}><th>{summary === "DAY" ? "दिवसपाळी" : summary === "NIGHT" ? "रात्रपाळी" : "इतर"}</th>{columns.map((column) => <td key={column}>{chart.shiftSummaries.filter((row) => row.summaryKey === summary && row.columnKey === column).map((row, index) => <span className="cell-pre" key={index}>{devanagari(row.valueText)}</span>)}</td>)}</tr>)}</tbody></table></div>
    {editMode && <details className="document-edit-panel no-print">
      <summary>पाळीनिहाय सारांश संपादन (Edit shift summary)</summary>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-muted">पाळीनिहाय संख्या व तपशील नोंदवा किंवा संपादित करा.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingSummary(null); setDialogOpen(true); }}>
          + सारांश नोंद जोडा
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>पाळी</th>
              <th>स्तंभ / घटक</th>
              <th>मूल्य</th>
              <th>कृती</th>
            </tr>
          </thead>
          <tbody>
            {chart.shiftSummaries.map((s, idx) => (
              <tr key={`${s.summaryKey}-${s.columnKey}-${idx}`}>
                <td>{s.summaryKey === "DAY" ? "दिवसपाळी" : s.summaryKey === "NIGHT" ? "रात्रपाळी" : "इतर"}</td>
                <td>{s.columnKey}</td>
                <td>{devanagari(s.valueText)}</td>
                <td>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingSummary(s); setDialogOpen(true); }}>
                    संपादित करा
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>}
    <ShiftSummaryDialog
      date={date}
      summary={editingSummary}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function OfficerRegister({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editingRow, setEditingRow] = useState<OfficerRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const parts = splitRegister(chart.officerSummary, 2);
  return <Section title="अधिकारी कर्तव्य नोंद" count={chart.officerSummary.length}>
    <div className="c1-officer-register">{parts.map((part, index) => <table className="data-table" key={index}>
      <thead><tr><th scope="col">अ.क्र.</th><th scope="col">अधिकारी</th><th scope="col">कर्तव्य</th></tr></thead>
      <tbody>{part.map((row) => <tr key={row.rowNo} data-officer-row={row.rowNo} title={`Source: ${row.source}`}>
        <td>{devanagari(row.rowNo)}</td><td>{row.officerText}</td><td className="cell-pre">{row.dutyText}{row.source !== "SOURCE" && <Badge tone={row.source === "OVERRIDE" ? "blue" : "amber"}>{row.source}</Badge>}</td>
      </tr>)}</tbody>
    </table>)}</div>
    {!parts.length && <p className="document-empty">नोंद नाही</p>}
    {editMode && <details className="document-edit-panel no-print">
      <summary>अधिकारी कर्तव्य नोंद संपादन (Edit officer duty register)</summary>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-muted">तपासणी व गस्त अधिकाऱ्यांच्या कर्तव्यांची नोंद जोडा किंवा संपादित करा.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingRow(null); setDialogOpen(true); }}>
          + अधिकारी नोंद जोडा
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>अ.क्र.</th>
              <th>अधिकारी</th>
              <th>कर्तव्य</th>
              <th>स्रोत</th>
              <th>कृती</th>
            </tr>
          </thead>
          <tbody>
            {chart.officerSummary.map((row) => (
              <tr key={row.rowNo}>
                <td>{devanagari(row.rowNo)}</td>
                <td>{row.officerText}</td>
                <td className="cell-pre">{row.dutyText}</td>
                <td><Badge tone={row.source === "OVERRIDE" ? "blue" : "amber"}>{row.source}</Badge></td>
                <td>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingRow(row); setDialogOpen(true); }}>
                    संपादित करा
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>}
    <OfficerSummaryDialog
      date={date}
      row={editingRow}
      defaultRowNo={chart.officerSummary.reduce((max, r) => Math.max(max, r.rowNo), 0) + 1}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function ScanSection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editingRow, setEditingRow] = useState<ScanRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const sessions = records(chart.template.layout.scanSessions);
  const groups = new Map<string, ChartDocument["scanSchedule"]>();
  chart.scanSchedule.forEach((row) => groups.set(row.sessionCode, [...(groups.get(row.sessionCode) ?? []), row]));
  return <Section id="scan-schedule" title="सुरक्षित नाशिक: गस्त व स्कॅनिंग वेळापत्रक" count={chart.scanSchedule.length}>
    {sessions.length > 0 && <div className="scan-session-grid">{sessions.map((session, index) => <section className="scan-session" key={index}><h3>{devanagari(displayText(session.session))}</h3><dl><dt>चौकी हद्द</dt><dd>{displayText(session.beat)}</dd><dt>पेट्रोलिंग</dt><dd>{displayText(session.patrol)}</dd></dl></section>)}</div>}
    {[...groups.entries()].map(([session, rows]) => <section key={session} className="hourly-scan-register"><h3>{session === "SCAN_HOURLY" ? "बिट मार्शल व ऑफिस स्टाफ" : session}</h3>
      <div className="c1-scan-register">{splitRegister(rows, 3).map((part, index) => <div key={index}>{part.map((row) => <div key={row.sequence} className="scan-hour" data-scan-row={`${row.sessionCode}-${row.sequence}`}>
        <span className="register-number">{devanagari(row.sequence)}</span><span className="scan-hour-window">{windowLabel(row.startTime, row.endTime)}</span><span>{row.location?.nameMr}</span>{row.person && <PersonCell person={row.person} />}{row.noteMr && <span className="cell-pre">{row.noteMr}</span>}
      </div>)}</div>)}</div>
    </section>)}
    {editMode && <details className="document-edit-panel no-print">
      <summary>गस्त व स्कॅनिंग वेळापत्रक संपादन (Edit scan schedule)</summary>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-muted">गस्त वेळापत्रकातील तासनिहाय नोंदी, कर्मचारी व चौकी जोडा किंवा संपादित करा.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingRow(null); setDialogOpen(true); }}>
          + गस्त नोंद जोडा
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>अ.क्र.</th>
              <th>सत्र</th>
              <th>वेळ</th>
              <th>ठिकाण / चौकी</th>
              <th>कर्मचारी</th>
              <th>नोंद</th>
              <th>कृती</th>
            </tr>
          </thead>
          <tbody>
            {chart.scanSchedule.map((row) => (
              <tr key={`${row.sessionCode}-${row.sequence}`}>
                <td>{devanagari(row.sequence)}</td>
                <td>{row.sessionCode}</td>
                <td>{windowLabel(row.startTime, row.endTime)}</td>
                <td>{row.location?.nameMr ?? "-"}</td>
                <td>{row.person ? personLabel(row.person) : "रिक्त"}</td>
                <td className="cell-pre">{row.noteMr ?? "-"}</td>
                <td>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingRow(row); setDialogOpen(true); }}>
                    संपादित करा
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>}
    <ScanRowDialog
      date={date}
      row={editingRow}
      defaultSequence={chart.scanSchedule.reduce((max, r) => Math.max(max, r.sequence), 0) + 1}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function SuddenChangesSection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editingChange, setEditingChange] = useState<SuddenChange | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  return <Section title="अचानक कर्तव्य बदल" count={chart.suddenChanges.length}>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>अ.क्र.</th><th>मूळ कर्मचारी</th><th>बदली कर्मचारी</th><th>कारण मीमांसा</th><th>नोंद</th><th>वेळ</th></tr></thead><tbody>{chart.suddenChanges.map((row) => <tr key={row.seq}><td>{devanagari(row.seq)}</td><td>{row.original && <PersonCell person={row.original} />}</td><td>{row.replacement && <PersonCell person={row.replacement} />}</td><td className="cell-pre">{row.detailMr}</td><td className="cell-pre">{row.noteMr}</td><td>{displayDateTime(row.createdAt)}</td></tr>)}</tbody></table></div>
    {editMode && <details className="document-edit-panel no-print">
      <summary>अचानक कर्तव्य बदल नोंदवा (Record sudden change)</summary>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-muted">कर्तव्यादरम्यान झालेल्या अचानक बदलांची नोंद व कारणमीमांसा जतन करा.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingChange(null); setDialogOpen(true); }}>
          + बदल नोंदवा
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>अ.क्र.</th>
              <th>मूळ कर्मचारी</th>
              <th>बदली कर्मचारी</th>
              <th>कारण मीमांसा</th>
              <th>नोंद</th>
              <th>कृती</th>
            </tr>
          </thead>
          <tbody>
            {chart.suddenChanges.map((c) => (
              <tr key={c.seq}>
                <td>{devanagari(c.seq)}</td>
                <td>{c.original ? personLabel(c.original) : "-"}</td>
                <td>{c.replacement ? personLabel(c.replacement) : "-"}</td>
                <td className="cell-pre">{c.detailMr}</td>
                <td className="cell-pre">{c.noteMr ?? "-"}</td>
                <td>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingChange(c); setDialogOpen(true); }}>
                    संपादित करा
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>}
    <SuddenChangeDialog
      date={date}
      change={editingChange}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function EventCard({ event }: { event: EventRecord }) {
  return <article className="event-block"><div className="event-heading"><h3>{event.titleMr}</h3><p>{chartDateLabel(event.eventDate)}{event.startTime ? `, ${windowLabel(event.startTime, null)}` : ""}{event.venueMr ? `, ${event.venueMr}` : ""}</p></div><div className="event-body"><p className="cell-pre">{event.fallInMr}</p><div className="event-assignments">{event.assignments.map((assignment, index) => <div key={`${assignment.sortOrder}-${index}`}><span>{devanagari(assignment.sortOrder)}</span><PersonCell person={assignment.person} /><span className="cell-pre">{assignment.roleMr}</span></div>)}</div></div></article>;
}

function EventsSection({ date, chart, editMode, onSaved }: { date: string; chart: ChartDocument; editMode: boolean; onSaved: () => void }) {
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  return <Section id="events" title="विशेष कार्यक्रम" count={chart.events.length}>
    {chart.events.map((event) => (
      <div key={event.eventId} className="relative">
        <EventCard event={event} />
        {editMode && (
          <div className="no-print mt-1 mb-3">
            <Button type="button" size="sm" variant="outline" onClick={() => { setEditingEvent(event); setDialogOpen(true); }}>
              कार्यक्रम व कर्मचारी संपादित करा
            </Button>
          </div>
        )}
      </div>
    ))}
    {chart.events.length === 0 && <p className="document-empty">नोंद नाही</p>}
    {editMode && <details className="document-edit-panel no-print">
      <summary>विशेष कार्यक्रम व्यवस्थापन (Manage special events)</summary>
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-muted">व्हीआयपी बंदोबस्त, सण-उत्सव किंवा विशेष कार्यक्रमांचे नियोजन व कर्मचारी नेमणूक करा.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setEditingEvent(null); setDialogOpen(true); }}>
          + नवीन कार्यक्रम जोडा
        </Button>
      </div>
    </details>}
    <EventDialog
      date={date}
      event={editingEvent}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSaved={onSaved}
    />
  </Section>;
}

function ChartSignoff({ chart }: { chart: ChartDocument }) {
  const raw = chart.template.overrides.values;
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return <footer className="c1-signoff">
    {[["signoff.1", "हजेरी लेखनिक"], ["signoff.2", "तपासणी अधिकारी"], ["signoff.3", "ठाणे शिक्का"]].map(([key, label]) => <div key={key}>
      <span>{label}</span><strong className="cell-pre" data-value-key={key}>{displayText(values[key])}</strong>
    </div>)}
  </footer>;
}

function FreeTableView({ table, editMode, onStructureOp }: { table: FreeTable; editMode: boolean; onStructureOp: (op: StructureOp) => Promise<void> }) {
  const [newColumn, setNewColumn] = useState("");
  const remove = () => { if (window.confirm(`Delete the table ${table.title}?`)) void onStructureOp({ op: "table.remove", id: table.id }); };
  return <section className="free-table-block">
    <div className="free-table-heading">
      {editMode ? <input aria-label={`Title for ${table.title}`} defaultValue={table.title} onBlur={(event) => { if (event.target.value !== table.title) void onStructureOp({ op: "table.title", id: table.id, text: event.target.value }); }} /> : <h3>{table.title}</h3>}
      {editMode && <div className="free-table-actions no-print"><Button size="sm" variant="outline" onClick={() => void onStructureOp({ op: "table.row.add", id: table.id })}>+ Row</Button><input aria-label="New column name" value={newColumn} onChange={(event) => setNewColumn(event.target.value)} placeholder="Column name" /><Button size="sm" variant="outline" onClick={() => { void onStructureOp({ op: "table.col.add", id: table.id, text: newColumn || "स्तंभ" }); setNewColumn(""); }}>+ Column</Button><Button size="sm" variant="danger" onClick={remove}>Delete table</Button></div>}
    </div>
    <div className="table-wrap"><table className="data-table"><thead><tr>{table.columns.map((column, index) => <th key={index}>{editMode ? <div className="free-table-column"><input defaultValue={column} aria-label={`Column ${index + 1}`} onBlur={(event) => { if (event.target.value !== column) void onStructureOp({ op: "table.col.label", id: table.id, index, text: event.target.value }); }} /><Button size="sm" variant="danger" disabled={table.columns.length <= 1} onClick={() => { if (window.confirm(`Delete column ${column}?`)) void onStructureOp({ op: "table.col.remove", id: table.id, index }); }}>Remove</Button></div> : column}</th>)}{editMode && <th className="no-print">Actions</th>}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{table.columns.map((_, columnIndex) => <td key={`${columnIndex}-${row[columnIndex] ?? ""}`}>{editMode ? <input className="free-table-cell" defaultValue={row[columnIndex] ?? ""} aria-label={`${table.title}, row ${rowIndex + 1}, column ${columnIndex + 1}`} onBlur={(event) => { if (event.target.value !== (row[columnIndex] ?? "")) void onStructureOp({ op: "table.cell", id: table.id, row: rowIndex, col: columnIndex, text: event.target.value }); }} /> : <span className="cell-pre">{row[columnIndex] ?? ""}</span>}</td>)}{editMode && <td className="no-print"><Button size="sm" variant="danger" disabled={table.rows.length <= 1} onClick={() => { if (window.confirm(`Delete row ${rowIndex + 1}?`)) void onStructureOp({ op: "table.row.remove", id: table.id, index: rowIndex }); }}>Delete row</Button></td>}</tr>)}</tbody></table></div>
  </section>;
}

function FreeTablesEditor({ chart, editMode, onStructureOp }: { chart: ChartDocument; editMode: boolean; onStructureOp: (op: StructureOp) => Promise<void> }) {
  const structure = (chart.template.overrides.structure as StructureOverrides | undefined) ?? {};
  const tables = structure.tables ?? [];
  if (!editMode && tables.length === 0) return null;
  return <Section title="तक्ता रचना" count={tables.length}>{editMode && <div className="no-print structure-add"><Button size="sm" variant="outline" onClick={() => void onStructureOp({ op: "table.add", title: "नवीन तक्ता", columns: ["तपशील"] })}>+ Add table</Button></div>}{tables.map((table) => <FreeTableView key={table.id} table={table} editMode={editMode} onStructureOp={onStructureOp} />)}</Section>;
}

function chartLocations(chart: ChartDocument): Location[] {
  const locations = new Map<number, Location>();
  for (const assignment of chart.assignments) {
    if (assignment.location) locations.set(assignment.location.locationId, assignment.location);
  }
  for (const state of chart.locationStates) {
    locations.set(state.location.locationId, state.location);
    if (state.chargeTo && !locations.has(state.chargeTo.locationId)) {
      locations.set(state.chargeTo.locationId, {
        locationId: state.chargeTo.locationId,
        code: state.chargeTo.code,
        nameMr: state.chargeTo.nameMr,
        kind: "",
      });
    }
  }
  return [...locations.values()];
}

export function ChartDocumentView({ date, chart, editMode, onRefresh }: { date: string; chart: ChartDocument; editMode: boolean; onRefresh: () => void }) {
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [locationStateTarget, setLocationStateTarget] = useState<LocationStateTarget | null>(null);
  const [addSeatTarget, setAddSeatTarget] = useState<{
    shift: Shift;
    columnNo?: number;
    dutyTitleMr?: string;
    locationId?: number | null;
  } | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [structureError, setStructureError] = useState("");
  const locations = useMemo(() => chartLocations(chart), [chart]);
  const structureOp = useCallback(async (op: StructureOp) => {
    setStructureBusy(true); setStructureError("");
    try { await apiPatch(`/api/charts/${date}/structure`, op); onRefresh(); }
    catch (reason) { setStructureError(reason instanceof Error ? reason.message : "Structure update failed"); }
    finally { setStructureBusy(false); }
  }, [date, onRefresh]);

  return <>
    <div className={`chart-document c1-document ${editMode ? "is-editing" : ""}`} data-chart-date={chart.chartDate}>
      <CommandDocument
        chart={chart}
        editMode={editMode}
        onSelect={setSelected}
        onEditState={setLocationStateTarget}
        onAddSeat={(group) => setAddSeatTarget({ shift: group.shift, columnNo: group.columnNo, dutyTitleMr: group.title })}
        onSaved={onRefresh}
      />
      <article className="chart-sheet" lang="mr" data-document-section="availability"><DocumentHeader chart={chart} /><AvailabilitySection date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /></article>
      <article className="chart-sheet" lang="mr" data-document-section="notices"><DocumentHeader chart={chart} /><NoticesSection date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /><OfficerRegister date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /></article>
      <article className="chart-sheet" lang="mr" data-document-section="manpower"><DocumentHeader chart={chart} /><MatrixSection chart={chart} editMode={editMode} onStructureOp={structureOp} /><div className="c1-summary-band"><ShiftSummarySection date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /><SuddenChangesSection date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /></div><FreeTablesEditor chart={chart} editMode={editMode} onStructureOp={structureOp} /><ChartSignoff chart={chart} /></article>
      {chart.events.length > 0 && <article className="chart-sheet" lang="mr" data-document-section="events"><DocumentHeader chart={chart} /><EventsSection date={date} chart={chart} editMode={editMode} onSaved={onRefresh} /></article>}
      {editMode && <div className="document-save-status no-print" role="status"><span>{structureBusy ? "Saving structure…" : "Structure edits saved"}</span>{structureError && <span className="status-line error">{structureError}</span>}</div>}
    </div>
    <AssignmentEditor date={date} assignment={selected} open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} onSaved={() => { setSelected(null); onRefresh(); }} />
    <LocationStateEditor
      date={date}
      target={locationStateTarget}
      locations={locations}
      open={locationStateTarget !== null}
      onOpenChange={(open) => { if (!open) setLocationStateTarget(null); }}
      onSaved={onRefresh}
    />
    <AddSeatDialog
      date={date}
      open={addSeatTarget !== null}
      onOpenChange={(open) => { if (!open) setAddSeatTarget(null); }}
      onSaved={onRefresh}
      defaultShift={addSeatTarget?.shift}
      defaultColumnNo={addSeatTarget?.columnNo}
      defaultDutyTitleMr={addSeatTarget?.dutyTitleMr}
      defaultLocationId={addSeatTarget?.locationId}
    />
  </>;
}

export function ChartWorkspace({ date }: { date: string }) {
  const [chart, setChart] = useState<ChartDocument | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    const request = date === localDateIso()
      ? ensureDailyDraft(date).then((result) => result.document)
      : apiFetch<ChartDocument>(`/api/charts/${date}`);
    return request.then(setChart).catch((reason: Error) => setError(reason.message));
  }, [date]);
  useEffect(() => { setChart(null); setEditMode(false); void load(); }, [load]);

  if (error) return <div className="page-shell"><div className="coming-soon"><h2>Chart could not be loaded</h2><p>{error}. Confirm that Fastify is running and that this date exists.</p><Link href="/charts" className={buttonClassName({ variant: "outline", size: "sm", className: "mt-4" })}>Back to all charts</Link></div></div>;
  if (!chart) return <div className="page-shell"><p className="muted">Loading chart…</p></div>;
  return <>
    <ChartToolbar date={date} editMode={editMode} onEditModeChange={setEditMode} lifecycle={chart.lifecycle} onReload={() => void load()} />
    <div className="page-shell chart-workspace"><ChartDocumentView date={date} chart={chart} editMode={editMode && chart.lifecycle !== "FINALIZED"} onRefresh={() => void load()} /></div>
  </>;
}
