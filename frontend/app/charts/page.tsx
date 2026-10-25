"use client";

/**
 * Purpose: Date-first chart archive.
 * Current role: Search and open locally stored chart documents.
 * Last meaningful change: 2026-10-18 — full-width inline filters and localized archive chrome.
 * Constraint: Lifecycle is read-only here; edits happen inside the chart document.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ChartReference } from "@/lib/types";
import { CHART_WEEKDAYS, filterCharts, type ChartLifecycleFilter, type ChartWeekdayFilter } from "@/lib/chart-search";
import { toolbarDateLabel, toolbarWeekday } from "@/lib/toolbar-dates";
import { useLocale } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { ComingSoon } from "@/components/coming-soon";
import { ManagementTable, type ManagementTableColumn } from "@/components/management-table";
import styles from "./page.module.css";

const COPY = {
  en: {
    title: "All Daily Duty Charts", date: "Date", weekday: "Weekday", lifecycle: "Lifecycle", chart: "Chart", open: "Open chart",
    search: "Search charts", placeholder: "Date, weekday or lifecycle", allWeekdays: "All weekdays", allLifecycles: "All states", from: "From", to: "To",
    invalidRange: "From date must be on or before To date.", empty: "No chart dates match the current filters.", service: "Fastify service unavailable",
    serviceDetail: "Start the root service with npm run dev.", count: (shown: number, total: number) => `${shown} of ${total} charts`,
    statuses: { DRAFT: "Draft", VALIDATED: "Validated", FINALIZED: "Finalized" },
  },
  mr: {
    title: "सर्व दैनिक कर्तव्य तक्ते", date: "दिनांक", weekday: "वार", lifecycle: "स्थिती", chart: "तक्ता", open: "तक्ता उघडा",
    search: "तक्ते शोधा", placeholder: "दिनांक, वार किंवा स्थिती", allWeekdays: "सर्व वार", allLifecycles: "सर्व स्थिती", from: "पासून", to: "पर्यंत",
    invalidRange: "पासून दिनांक हा पर्यंत दिनांकापेक्षा पुढे असू नये.", empty: "या शोधानुसार कोणतेही तक्ते सापडले नाहीत.", service: "Fastify सेवा उपलब्ध नाही",
    serviceDetail: "मुख्य सेवा सुरू करण्यासाठी npm run dev वापरा.", count: (shown: number, total: number) => `${total} पैकी ${shown} तक्ते`,
    statuses: { DRAFT: "मसुदा", VALIDATED: "पडताळलेला", FINALIZED: "अंतिम" },
  },
} as const;

function lifecycleTone(lifecycle: ChartReference["lifecycle"]) {
  return lifecycle === "FINALIZED" ? "green" : lifecycle === "VALIDATED" ? "blue" : "amber";
}

export default function ChartsPage() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [charts, setCharts] = useState<ChartReference[]>([]);
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<ChartLifecycleFilter>("ALL");
  const [weekday, setWeekday] = useState<ChartWeekdayFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<ChartReference[]>("/api/charts").then(setCharts).catch((reason: Error) => setError(reason.message)); }, []);
  const filtered = useMemo(() => filterCharts(charts, { query, lifecycle, weekday, from, to }), [charts, lifecycle, query, weekday, from, to]);
  const invalidRange = Boolean(from && to && from > to);
  const archiveColumns: ManagementTableColumn<ChartReference>[] = [
    { id: "date", label: copy.date, width: 150, minWidth: 135, maxWidth: 260, render: (chart) => toolbarDateLabel(chart.date, locale) },
    { id: "weekday", label: copy.weekday, width: 145, minWidth: 125, maxWidth: 260, render: (chart) => toolbarWeekday(chart.date, locale) },
    { id: "lifecycle", label: copy.lifecycle, width: 145, minWidth: 125, maxWidth: 240, render: (chart) => <Badge tone={lifecycleTone(chart.lifecycle)}>{copy.statuses[chart.lifecycle]}</Badge> },
    { id: "chart", label: copy.chart, width: 145, minWidth: 130, maxWidth: 260, render: (chart) => <Link className="row-action inline-flex" href={`/charts/${chart.date}`}>{copy.open}</Link> },
  ];

  return <div className={`page-shell ${styles.archive}`}>
    <div className="page-heading"><h1>{copy.title}</h1></div>
    {error ? <ComingSoon title={copy.service} detail={`${copy.serviceDetail} ${error}`} /> : <ManagementTable
      storageKey="panchavati-chart-archive"
      ariaLabel={copy.title}
      columns={archiveColumns}
      rows={filtered}
      rowKey={(chart) => chart.date}
      emptyMessage={invalidRange ? copy.invalidRange : copy.empty}
      countLabel={copy.count(filtered.length, charts.length)}
      toolbar={<>
        <div className="form-field management-table-search-field">
          <label htmlFor="chart-search">{copy.search}</label>
          <input id="chart-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.placeholder} />
        </div>
        <div className="form-field management-table-filter-field">
          <label htmlFor="chart-weekday">{copy.weekday}</label>
          <select id="chart-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value as ChartWeekdayFilter)}>
            <option value="ALL">{copy.allWeekdays}</option>
            {CHART_WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{locale === "mr" ? day.marathi : day.label}</option>)}
          </select>
        </div>
        <div className="form-field management-table-filter-field">
          <label htmlFor="chart-lifecycle">{copy.lifecycle}</label>
          <select id="chart-lifecycle" value={lifecycle} onChange={(event) => setLifecycle(event.target.value as ChartLifecycleFilter)}>
            <option value="ALL">{copy.allLifecycles}</option>
            <option value="DRAFT">{copy.statuses.DRAFT}</option>
            <option value="VALIDATED">{copy.statuses.VALIDATED}</option>
            <option value="FINALIZED">{copy.statuses.FINALIZED}</option>
          </select>
        </div>
        <div className="form-field management-table-date-field">
          <label htmlFor="chart-from">{copy.from}</label>
          <input id="chart-from" type="date" value={from} aria-invalid={invalidRange || undefined} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="form-field management-table-date-field">
          <label htmlFor="chart-to">{copy.to}</label>
          <input id="chart-to" type="date" value={to} aria-invalid={invalidRange || undefined} onChange={(event) => setTo(event.target.value)} />
        </div>
      </>}
    />}
  </div>;
}
