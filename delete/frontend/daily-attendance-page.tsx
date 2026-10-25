"use client";

/**
 * Purpose: Date-scoped attendance for active staff and explicit finalized snapshot records.
 * Current role: Checkbox exceptions, weekly-off defaults, and persisted per-person feedback.
 * Last meaningful change: 2026-10-18 — daily attendance UI.
 * Constraint: Defaults are read-only projections; only clerk actions persist attendance rows.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ManagementTable, type ManagementTableColumn } from "@/components/management-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { attendanceLabels, clearDailyAttendance, getDailyAttendance, setDailyAttendance, type AttendanceResult, type AttendanceRow, type AttendanceStatus } from "@/lib/attendance";
import { ensureDailyDraft } from "@/lib/daily-start";
import { dateLabel, localDateIso, weekdayMr } from "@/lib/format";

type StatusFilter = "all" | AttendanceStatus;
const failureMessage = (reason: unknown) => reason instanceof Error ? reason.message : "Could not save attendance.";

export default function AttendancePage() {
  const [date, setDate] = useState("");
  const [attendance, setAttendance] = useState<AttendanceResult | null>(null);
  const [query, setQuery] = useState("");
  const [rank, setRank] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | "start" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("date");
    setDate(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : localDateIso());
  }, []);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setLoading(true);
    setError("");
    setMessage("");
    const load = async () => {
      // Opening today's attendance starts the same empty draft as the dashboard. Browsing another
      // date is read-only until the clerk explicitly starts that date.
      if (date === localDateIso()) await ensureDailyDraft(date);
      return getDailyAttendance(date);
    };
    void load().then((result) => { if (alive) setAttendance(result); })
      .catch((reason: unknown) => { if (alive) setError(failureMessage(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date, refresh]);

  const current = attendance?.date === date ? attendance : null;
  const ranks = useMemo(() => [...new Set(current?.rows.map((row) => row.person.rankCode) ?? [])], [current]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (current?.rows ?? []).filter((row) => (rank === "all" || row.person.rankCode === rank)
      && (status === "all" || row.status === status)
      && [row.person.nameMr, row.person.rankCode, row.person.rankShortFormMr, row.person.buckleNo]
        .filter(Boolean).join(" ").toLocaleLowerCase().includes(search));
  }, [current, query, rank, status]);
  const busy = busyId !== null;
  const writable = Boolean(current?.chartId && current.lifecycle !== "FINALIZED" && !loading && !error);

  const save = async (row: AttendanceRow, present: boolean | null) => {
    if (!writable || busy) return;
    setBusyId(row.person.staffId);
    setError("");
    setMessage("");
    try {
      const result = present === null
        ? await clearDailyAttendance(date, row.person.staffId)
        : await setDailyAttendance(date, row.person.staffId, present);
      setAttendance(result);
      setMessage(present === null ? `${row.person.nameMr}: default restored.` : `${row.person.nameMr}: ${present ? "present" : "absent"} saved.`);
    } catch (reason) {
      setError(failureMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  const startDate = async () => {
    setBusyId("start");
    setError("");
    setMessage("");
    try {
      await ensureDailyDraft(date);
      setAttendance(await getDailyAttendance(date));
      setMessage("Empty draft opened.");
    } catch (reason) {
      setError(failureMessage(reason));
    } finally {
      setBusyId(null);
    }
  };

  const columns: ManagementTableColumn<AttendanceRow>[] = [
    { id: "name", label: "Marathi name", minWidth: 170, maxWidth: 360, cellClassName: "cell-pre font-medium", render: (row) => row.person.nameMr },
    { id: "rank", label: "Rank", width: 108, minWidth: 108, maxWidth: 180, cellClassName: "management-table-code", render: (row) => row.person.rankCode },
    { id: "buckle", label: "Buckle", minWidth: 76, maxWidth: 150, render: (row) => row.person.buckleNo || "" },
    { id: "weekly-off", label: "Weekly off", minWidth: 110, maxWidth: 200, cellClassName: "cell-pre", render: (row) => row.weeklyOff || "" },
    { id: "present", label: "Present", minWidth: 80, maxWidth: 120, render: (row) => <label className="inline-flex items-center gap-2">
      <input type="checkbox" className="size-4" style={{ accentColor: "var(--brand-blue)" }} checked={row.present === true}
        aria-label={`Present: ${row.person.nameMr}`}
        aria-checked={row.present === null ? "mixed" : row.present}
        disabled={!writable || busy}
        onChange={(event) => void save(row, event.target.checked)} />
      {busyId === row.person.staffId && <span className="text-xs text-slate-500">Saving…</span>}
    </label> },
    { id: "status", label: "Attendance", minWidth: 130, maxWidth: 220, render: (row) => <Badge tone={row.status === "ABSENT" ? "red" : row.status === "WEEKLY_OFF" ? "amber" : row.status === "PRESENT" ? "green" : "slate"}>{attendanceLabels[row.status]}</Badge> },
    { id: "source", label: "Source / other records", minWidth: 180, maxWidth: 360, cellClassName: "cell-pre", render: (row) => <>
      <span>{row.source === "MANUAL" ? "Clerk confirmed" : row.source === "WEEKLY_OFF" ? "Staff profile default" : row.source === "AVAILABILITY" ? "Chart availability" : row.source === "UNRECORDED" ? "No snapshot record" : "Default (unconfirmed)"}</span>
      {row.otherAvailability.length > 0 && <div className="mt-1 text-xs text-slate-500">{row.otherAvailability.map((item) => [item.category, item.timeStart?.slice(0, 5), item.timeEnd?.slice(0, 5)].filter(Boolean).join(" ")).join("; ")}</div>}
    </> },
    { id: "actions", label: "Actions", minWidth: 110, maxWidth: 160, render: (row) => row.attendanceId !== null
      ? <button type="button" className="row-action" disabled={!writable || busy} onClick={() => void save(row, null)}>Use default</button>
      : null },
  ];

  return <div className="page-shell">
    <div className="page-heading">
      <h1>Daily Attendance</h1>
      {current?.chartId && <Link href={`/charts/${date}`} className="row-action">Open chart</Link>}
    </div>
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="form-field">
        <label htmlFor="attendance-date">Date</label>
        <input id="attendance-date" type="date" value={date} disabled={busy} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
      </div>
      {date && <span className="pb-2 text-sm text-slate-600">{dateLabel(date)} {weekdayMr(date)}</span>}
      {current?.lifecycle && <Badge tone={current.lifecycle === "FINALIZED" ? "green" : "amber"}>{current.lifecycle}</Badge>}
    </div>
    <p className="mb-3 text-sm text-slate-500">Present is the default; a known weekly off is unchecked. Unchecking saves an explicit absence. Each change saves to PostgreSQL.</p>
    {error && <div role="alert" className="status-line error mb-3 flex flex-wrap items-center gap-3"><span>{error}</span><Button size="sm" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>Reload attendance</Button></div>}
    {message && <p role="status" className="status-line success mb-3">{message}</p>}
    {loading && <p role="status" className="muted mb-3">Loading attendance…</p>}
    {!loading && current?.chartId === null && <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span>This date has no chart.</span>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void startDate()}>{busyId === "start" ? "Opening…" : "Start empty draft"}</Button>
    </div>}
    {current?.lifecycle === "FINALIZED" && <p className="mb-3 text-sm text-slate-600">Finalized: read-only snapshot records. Unconfirmed defaults were not saved and are shown as “Not recorded”.</p>}
    {current && !loading && <ManagementTable
      storageKey="panchavati-management-attendance"
      ariaLabel={current.lifecycle === "FINALIZED" ? "Finalized attendance records and current directory" : "Daily attendance for active staff"}
      columns={columns}
      rows={filtered}
      rowKey={(row) => row.person.staffId}
      emptyMessage="No staff match these filters."
      countLabel={`${filtered.length} of ${current.rows.length} ${current.lifecycle === "FINALIZED" ? "staff records" : "active staff"}`}
      toolbar={<>
        <div className="form-field staff-search-field"><label htmlFor="attendance-search">Search staff</label><input id="attendance-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, rank or buckle" /></div>
        <div className="form-field staff-filter-field"><label htmlFor="attendance-rank">Rank</label><select id="attendance-rank" value={rank} onChange={(event) => setRank(event.target.value)}><option value="all">All ranks</option>{ranks.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
        <div className="form-field staff-filter-field"><label htmlFor="attendance-status">Attendance</label><select id="attendance-status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All statuses</option>{Object.entries(attendanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </>}
    />}
  </div>;
}
