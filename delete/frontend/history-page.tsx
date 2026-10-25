/**
 * Purpose: Read-only list of stored chart dates.
 * Current role: Compact history table with an honest advanced-search placeholder.
 * Last meaningful change: 2026-10-18 — numbered history without an empty count toolbar.
 * Constraint: Search behavior remains deferred until its reviewed endpoint exists.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ChartReference } from "@/lib/types";
import { dateLabel, weekdayMr } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { ComingSoon } from "@/components/coming-soon";
import { ManagementTable, type ManagementTableColumn } from "@/components/management-table";

export default function HistoryPage() {
  const [charts, setCharts] = useState<ChartReference[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<ChartReference[]>("/api/charts").then(setCharts).catch((reason: Error) => setError(reason.message)); }, []);
  const historyColumns: ManagementTableColumn<ChartReference>[] = [
    { id: "date", label: "Date", width: 135, minWidth: 135, maxWidth: 250, cellClassName: "font-semibold text-navy", render: (chart) => dateLabel(chart.date) },
    { id: "weekday", label: "Weekday", width: 135, minWidth: 135, maxWidth: 250, render: (chart) => weekdayMr(chart.date) },
    { id: "lifecycle", label: "Lifecycle", width: 125, minWidth: 125, maxWidth: 240, render: (chart) => <Badge tone={chart.lifecycle === "FINALIZED" ? "green" : chart.lifecycle === "VALIDATED" ? "blue" : "amber"}>{chart.lifecycle}</Badge> },
    { id: "chart", label: "Chart", width: 145, minWidth: 145, maxWidth: 260, render: (chart) => <Link className="row-action inline-flex" href={`/charts/${chart.date}`}>Open chart</Link> },
  ];

  return <div className="page-shell">
    <div className="page-heading"><h1>Chart history</h1></div>
    {error ? <ComingSoon title="Fastify service unavailable" detail={`Start the root service with npm run dev. ${error}`} /> : <ManagementTable
      storageKey="panchavati-history"
      ariaLabel="Chart history"
      columns={historyColumns}
      rows={charts}
      rowKey={(chart) => chart.date}
      emptyMessage="No chart dates returned by Fastify."
    />}
    <div className="mt-6"><ComingSoon title="Version browsing and cross-chart search" detail="Full version browsing and cross-chart search remain explicitly marked below." /></div>
  </div>;
}
