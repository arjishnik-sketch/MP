/**
 * Purpose: Local print/export entry point.
 * Current role: Routes clerks to the chart document and exposes honest export WIP states.
 * Last meaningful change: 2026-10-18 — aligned menus with the production toolbar contract.
 * Constraint: No outbound sharing or incomplete PNG generation.
 */
"use client";

import { ComingSoon } from "@/components/coming-soon";

export default function ReportsPage() {
  return <div className="page-shell"><div className="page-heading"><h1>Reports</h1></div><ComingSoon title="WIP — Monthly reports" detail="Monthly report generation is not enabled." /></div>;
}
