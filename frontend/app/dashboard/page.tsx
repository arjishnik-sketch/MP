"use client";

/**
 * Purpose: Compact, read-only D1 dashboard for a selected calendar date.
 * Current role: Upper date/status band followed by command, directory and attendance strength.
 * Last meaningful change: 2026-10-18 — removed chowki tiles and duplicate date controls from the demo view.
 * Constraint: Only browser-local today may bootstrap; historical/missing dates are GET-only views.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CompactPersonLabel } from "@/components/rank-label";
import { ApiError, apiFetch } from "@/lib/api";
import { getDailyAttendance, type AttendanceResult } from "@/lib/attendance";
import { ensureDailyDraft } from "@/lib/daily-start";
import {
  dashboardDateFromSearch, dashboardDateMode, isDashboardDate, stationOfficerDirectory, summarizeDashboardAttendance,
} from "@/lib/dashboard-summary";
import { dateLabel, localDateIso, weekdayMr } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { ChartDocument, ChartReference, MastersResponse } from "@/lib/types";
import styles from "./dashboard.module.css";

const chrome = {
  en: {
    todayOverview: "Today’s overview", dayOverview: "Daily overview", date: "Overview date", stationDirectory: "Current station directory",
    directoryLoading: "Loading directory…", directoryUnavailable: "The staff directory could not be loaded.",
    openToday: "Open today’s chart", openChart: "Open chart", chartLoading: "Loading chart…", noSavedChart: "No saved chart",
    registered: "Registered staff", registeredNow: "Registered now", recordedPresent: "Present (recorded)",
    present: "Present", absent: "Absent", onLeave: "On Leave",
    defaultPresent: "Present (default)", defaultHelp: "Default presence has not been confirmed by the clerk.",
    weeklyOff: "Weekly off", weeklyOffRecorded: "recorded", weeklyOffProfile: "from current staff profiles",
    recordedAbsent: "Absent (recorded)", unrecorded: "Not recorded", attendance: "Attendance for the selected date",
    assignDutiesLink: "Assign & Manage Duties →",
    dutyProgress: (assigned: number, total: number) => `${assigned} of ${total} duty charges assigned so far`,
    allAssigned: (total: number) => `All ${total} duty charges assigned. Ready for review and print.`,
    prepTomorrow: "Prepare Tomorrow’s Duty Chart →",
    loading: "Loading…", loadingDay: "Loading this day’s records…", unavailable: "This day’s records could not be loaded.",
    missing: "No chart is saved for this date.", retry: "Try again", draft: "Draft", validated: "Validated", finalized: "Finalized",
  },
  mr: {
    todayOverview: "आजचा आढावा", dayOverview: "दैनिक आढावा", date: "आढाव्याची तारीख", stationDirectory: "सध्याची अधिकारी नामावली",
    directoryLoading: "नामावली लोड होत आहे…", directoryUnavailable: "कर्मचारी नामावली लोड करता आली नाही.",
    openToday: "आजचा तक्ता उघडा", openChart: "तक्ता उघडा", chartLoading: "तक्ता लोड होत आहे…", noSavedChart: "जतन केलेला तक्ता नाही",
    registered: "नोंदणीकृत कर्मचारी", registeredNow: "सध्या नोंदणीकृत", recordedPresent: "हजर (नोंदवलेले)",
    present: "हजर", absent: "गैरहजर", onLeave: "रजेवर / सुट्टी",
    defaultPresent: "हजर (पूर्वनिर्धारित)", defaultHelp: "पूर्वनिर्धारित हजेरीला लेखनिकाने पुष्टी दिलेली नाही.",
    weeklyOff: "साप्ताहिक सुट्टी", weeklyOffRecorded: "नोंदवलेले", weeklyOffProfile: "सध्याच्या कर्मचारी नोंदींमधून",
    recordedAbsent: "गैरहजर (नोंदवलेले)", unrecorded: "नोंद नाही", attendance: "निवडलेल्या तारखेची हजेरी",
    assignDutiesLink: "कर्तव्य वाटप व व्यवस्थापन →",
    dutyProgress: (assigned: number, total: number) => `${total} पैकी ${assigned} कर्तव्ये नेमण्यात आली आहेत`,
    allAssigned: (total: number) => `सर्व ${total} कर्तव्ये नेमली गेली आहेत. पडताळणी व प्रिंटसाठी तयार.`,
    prepTomorrow: "उद्याचे कर्तव्य वाटप तयार करा →",
    loading: "लोड होत आहे…", loadingDay: "या दिवसाच्या नोंदी लोड होत आहेत…", unavailable: "या दिवसाच्या नोंदी लोड करता आल्या नाहीत.",
    missing: "या तारखेसाठी तक्ता जतन केलेला नाही.", retry: "पुन्हा प्रयत्न करा", draft: "मसुदा", validated: "तपासलेला", finalized: "अंतिम",
  },
} as const;

type DayRecords = {
  date: string;
  status: "loading" | "ready" | "missing" | "error";
  chart: ChartDocument | null;
  attendance: AttendanceResult | null;
};

export default function DashboardPage() {
  const { locale } = useLocale();
  const copy = chrome[locale];
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [mastersFailed, setMastersFailed] = useState(false);
  const [today, setToday] = useState("");
  // Null follows local midnight; an explicit URL date stays on that date.
  const [dateChoice, setDateChoice] = useState<string | null>(null);
  const selectedDate = dateChoice ?? today;
  const [records, setRecords] = useState<DayRecords>({ date: "", status: "loading", chart: null, attendance: null });
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const syncDate = () => { if (!document.hidden) setToday(localDateIso()); };
    const syncUrl = () => {
      const localToday = localDateIso();
      const queryDate = new URLSearchParams(window.location.search).get("date");
      setToday(localToday);
      setDateChoice(isDashboardDate(queryDate) ? dashboardDateFromSearch(window.location.search, localToday) : null);
    };
    const refreshOnReturn = () => {
      if (!document.hidden) { syncDate(); setRefresh((value) => value + 1); }
    };
    syncUrl();
    const dateTimer = window.setInterval(syncDate, 60_000);
    window.addEventListener("popstate", syncUrl);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.clearInterval(dateTimer);
      window.removeEventListener("popstate", syncUrl);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setMastersFailed(false);
    // Directory discovery does not depend on a chart/attendance request succeeding.
    void apiFetch<MastersResponse>("/api/masters")
      .then((data) => { if (alive) setMasters(data); })
      .catch(() => { if (alive) setMastersFailed(true); });
    return () => { alive = false; };
  }, [refresh]);

  useEffect(() => {
    if (!selectedDate || !today) return;
    let alive = true;
    const date = selectedDate;
    // Check actual local today at dispatch as well, so a suspended tab cannot bootstrap yesterday.
    const mode = dashboardDateMode(date, localDateIso());
    setRecords({ date, status: "loading", chart: null, attendance: null });
    const readChart = async (): Promise<ChartDocument | null> => {
      if (mode === "bootstrap-today") return (await ensureDailyDraft(date)).document;
      try { return await apiFetch<ChartDocument>(`/api/charts/${encodeURIComponent(date)}`); }
      catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
    };
    const load = async () => {
      // Today's bootstrap finishes before its attendance projection is read. Other dates use only GET.
      const pair = mode === "bootstrap-today"
        ? await readChart().then(async (chart) => [chart, await getDailyAttendance(date)] as const)
        : await Promise.all([readChart(), getDailyAttendance(date)]);
      const [chart, attendance] = pair;
      if ((chart && chart.chartDate !== date) || attendance.date !== date
        || (chart ? attendance.chartId !== chart.chartId || attendance.lifecycle !== chart.lifecycle : attendance.chartId !== null)) {
        throw new Error("Selected-day records changed while loading.");
      }
      if (alive) setRecords({ date, status: chart ? "ready" : "missing", chart, attendance });
    };
    void load().catch(() => { if (alive) setRecords({ date, status: "error", chart: null, attendance: null }); });
    return () => { alive = false; };
  }, [selectedDate, today, refresh]);

  // Date-key both reads at render time too: a new choice cannot flash the previous day's facts.
  const matchingRecords = records.date === selectedDate ? records : null;
  const chart = matchingRecords?.chart ?? null;
  const attendance = matchingRecords?.attendance ?? null;
  const dayLoading = !selectedDate || !matchingRecords || matchingRecords.status === "loading";
  const directory = useMemo(() => masters ? stationOfficerDirectory(masters) : null, [masters]);
  const strength = useMemo(() => summarizeDashboardAttendance(masters?.staff ?? [], attendance, selectedDate), [masters, attendance, selectedDate]);
  const isToday = selectedDate === today;
  const attendanceReady = attendance !== null;
  const lifecycleLabel = (value: ChartReference["lifecycle"]) => value === "FINALIZED" ? copy.finalized : value === "VALIDATED" ? copy.validated : copy.draft;

  const retry = () => setRefresh((value) => value + 1);
  const weekday = !selectedDate ? "" : locale === "mr" ? weekdayMr(selectedDate)
    : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${selectedDate}T00:00:00Z`));

  const tomorrow = useMemo(() => {
    if (!today) return "";
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const assignmentsCount = chart?.assignments.length ?? 0;
  const filledAssignments = chart?.assignments.filter((a) => a.person !== null).length ?? 0;
  const vacantAssignments = chart?.assignments.filter((a) => a.person === null).length ?? 0;

  return <div className={styles.page} lang={locale}>
    <header className={styles.heading}>
      <div className={styles.headingIdentity}>
        <h1>{isToday ? copy.todayOverview : copy.dayOverview}</h1>
        <div className={styles.dateLine}>
          <time className={styles.dateValue} dateTime={selectedDate || undefined} aria-label={copy.date}>{selectedDate ? dateLabel(selectedDate) : "…"}</time>
          <span>{weekday}</span>
          {chart && <span className={styles.lifecycle} data-lifecycle={chart.lifecycle}>{lifecycleLabel(chart.lifecycle)}</span>}
        </div>
      </div>

      <div className={styles.headingAction}>
        {chart ? <Link href={`/charts/${selectedDate}`} className={styles.openChart}>{isToday ? copy.openToday : copy.openChart}<span aria-hidden="true">↗</span></Link>
          : <span className={styles.actionStatus}>{dayLoading ? copy.chartLoading : matchingRecords?.status === "missing" ? copy.noSavedChart : copy.unavailable}</span>}
      </div>
    </header>

    {chart && assignmentsCount > 0 && (
      <section className={styles.prepBanner}>
        <div className={styles.prepInfo}>
          <strong>
            {filledAssignments >= assignmentsCount
              ? copy.allAssigned(assignmentsCount)
              : copy.dutyProgress(filledAssignments, assignmentsCount)}
          </strong>
          <span className={styles.prepDetail}>
            {vacantAssignments > 0
              ? `${vacantAssignments} ${locale === "mr" ? "जागा रिक्त आहेत" : "seats vacant"}`
              : `${locale === "mr" ? "सर्व कर्तव्य जागा पूर्ण भरल्या आहेत" : "all seats occupied"}`}
          </span>
        </div>
        <div className={styles.prepActions}>
          <Link
            href={`/daily-work/duties?date=${selectedDate}`}
            className={styles.prepButton}
          >
            {copy.assignDutiesLink}
          </Link>
          {isToday && tomorrow && (
            <Link
              href={`/daily-work/duties?date=${tomorrow}`}
              className={styles.prepButtonSecondary}
            >
              {copy.prepTomorrow}
            </Link>
          )}
        </div>
      </section>
    )}

    <section className={styles.command} aria-label={copy.stationDirectory} lang="mr">
      <section className={styles.senior}>
        <span className={styles.label}>ठाणे प्रमुख</span>
        <span className={styles.value}>{directory ? directory.senior ? <CompactPersonLabel person={directory.senior} /> : "अधिकारी नोंद नाही"
          : <span lang={locale}>{mastersFailed ? copy.directoryUnavailable : copy.directoryLoading}</span>}</span>
      </section>
      {directory && <div className={styles.branches}>
        {directory.branches.map((branch) => <div className={styles.branch} key={branch.branch}>
          <span className={styles.label}>{branch.branch}</span>
          <span className={styles.value}>{branch.person ? <CompactPersonLabel person={branch.person} /> : "अधिकारी नोंद नाही"}</span>
        </div>)}
      </div>}
    </section>
    {mastersFailed && <div className={styles.inlineError} role="alert"><span>{copy.directoryUnavailable}</span><button type="button" onClick={retry}>{copy.retry}</button></div>}

    <section className={styles.strength} aria-label={copy.attendance}>
      <div className={`${styles.metric} ${styles.metricPrimary}`}>
        <span className={styles.label}>{isToday ? copy.registered : copy.registeredNow}</span>
        <span className={styles.value}>{masters ? strength.registered : <span aria-label={copy.loading}>…</span>}</span>
      </div>
      <div className={`${styles.metric} ${styles.metricPresent}`}>
        <span className={styles.label}>{copy.present}</span>
        <span className={styles.value}>{attendanceReady ? (strength.recordedPresent + strength.defaultPresent) : <span aria-label={copy.loading}>…</span>}</span>
      </div>
      <div className={`${styles.metric} ${styles.metricAbsent}`}>
        <span className={styles.label}>{copy.absent}</span>
        <span className={styles.value}>{attendanceReady ? strength.recordedAbsent : <span aria-label={copy.loading}>…</span>}</span>
      </div>
      <div className={`${styles.metric} ${styles.metricLeave}`}>
        <span className={styles.label}>{copy.onLeave}</span>
        <span className={styles.value}>{attendanceReady ? strength.weeklyOff : <span aria-label={copy.loading}>…</span>}</span>
      </div>
      <div className={styles.metric}><span className={styles.label}>{copy.recordedPresent}</span><span className={styles.value}>{attendanceReady ? strength.recordedPresent : <span aria-label={copy.loading}>…</span>}</span></div>
      <div className={styles.metric} title={copy.defaultHelp}><span className={styles.label}>{copy.defaultPresent}</span><span className={styles.value}>{attendanceReady ? strength.defaultPresent : <span aria-label={copy.loading}>…</span>}</span></div>
      <div className={styles.metric} title={attendanceReady ? `${strength.recordedWeeklyOff} ${copy.weeklyOffRecorded}; ${strength.profileWeeklyOff} ${copy.weeklyOffProfile}` : undefined}><span className={styles.label}>{copy.weeklyOff}</span><span className={styles.value}>{attendanceReady ? strength.weeklyOff : <span aria-label={copy.loading}>…</span>}</span></div>
      <div className={styles.metric}><span className={styles.label}>{copy.recordedAbsent}</span><span className={styles.value}>{attendanceReady ? strength.recordedAbsent : <span aria-label={copy.loading}>…</span>}</span></div>
      {strength.unrecorded > 0 && <div className={styles.metric}><span className={styles.label}>{copy.unrecorded}</span><span className={styles.value}>{strength.unrecorded}</span></div>}
    </section>

    {dayLoading ? <p className={styles.dayStatus} role="status">{copy.loadingDay}</p>
      : matchingRecords?.status === "error" ? <div className={styles.inlineError} role="alert"><span>{copy.unavailable}</span><button type="button" onClick={retry}>{copy.retry}</button></div>
        : matchingRecords?.status === "missing" ? <p className={styles.dayStatus} role="status">{copy.missing}</p> : null}
  </div>;
}
