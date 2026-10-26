"use client";

/**
 * Purpose: Standing Charges management page with explicit scope separation.
 * Clarifies Permanent Standing Charges (long-lived baseline) vs. Date-Specific Overrides (affects selected date only).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, apiPatch, apiPost, apiDelete, ApiError } from "@/lib/api";
import { localDateIso, personLabel, compactPersonLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { Assignment, ChartDocument, Person } from "@/lib/types";
import { DailyDateBar } from "@/components/daily-date-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const CORE_STANDING_CHARGES = [
  { title: "ठाणे अंमलदार", shift: "DAY", desc: "दिवसपाळी ठाणे अंमलदार कक्ष" },
  { title: "ठाणे अंमलदार", shift: "NIGHT", desc: "रात्रपाळी ठाणे अंमलदार कक्ष" },
  { title: "CCTNS", shift: "DAY", desc: "दिवस संगणक नोंदणी" },
  { title: "CCTNS", shift: "NIGHT", desc: "रात्र संगणक नोंदणी" },
  { title: "वायरलेस", shift: "DAY", desc: "बिनतारी संदेश कक्ष" },
  { title: "वायरलेस", shift: "NIGHT", desc: "बिनतारी संदेश कक्ष" },
  { title: "हजरपाळी", shift: "DAY", desc: "मदतनीस" },
  { title: "हजरपाळी", shift: "NIGHT", desc: "मदतनीस" },
  { title: "पिटर मोबाईल", shift: "DAY", desc: "गस्त वाहन" },
  { title: "पिटर मोबाईल", shift: "NIGHT", desc: "गस्त वाहन" },
  { title: "सी.आर. मोबाईल", shift: "DAY", desc: "गस्त वाहन" },
  { title: "सी.आर. मोबाईल", shift: "NIGHT", desc: "गस्त वाहन" },
  { title: "डेल्टा मोबाईल", shift: "DAY", desc: "गस्त वाहन" },
  { title: "डेल्टा मोबाईल", shift: "NIGHT", desc: "गस्त वाहन" },
  { title: "हजेरी मास्तर", shift: "DAY", desc: "कार्यालयीन हजेरी नोंद" },
  { title: "मुद्देमाल कारकुन", shift: "DAY", desc: "मुद्देमाल कक्ष" },
  { title: "नगदी कारकुन", shift: "DAY", desc: "कार्यालयीन शाखा" },
  { title: "बारनिशी", shift: "DAY", desc: "टपाल व नोंद" },
  { title: "गोपनिय ड्युटी", shift: "DAY", desc: "गोपनीय शाखा" },
  { title: "क्राईम कारकुन", shift: "DAY", desc: "गुन्हे शाखा" },
  { title: "सेशन समन्स", shift: "DAY", desc: "न्यायालयीन शाखा" },
  { title: "वारंट", shift: "DAY", desc: "वॉरंट पथक" },
  { title: "समन्स", shift: "DAY", desc: "समन्स पथक" },
];

export default function StandingChargesPage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading standing charges…</p></div>}>
      <StandingChargesContent />
    </Suspense>
  );
}

function StandingChargesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { locale } = useLocale();

  const urlDate = searchParams.get("date");
  const today = localDateIso();
  const selectedDate = urlDate || today;

  const [chart, setChart] = useState<ChartDocument | null>(null);
  const [staffList, setStaffList] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = async (dateStr: string) => {
    setLoading(true);
    setError("");
    try {
      const [chartData, staffData] = await Promise.all([
        apiFetch<ChartDocument>(`/api/charts/${dateStr}`),
        apiFetch<{ staff: Person[] }>("/api/masters").then((m) => m.staff).catch(() => []),
      ]);
      setChart(chartData);
      setStaffList(staffData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(locale === "mr" ? "या तारखेचा तक्ता सापडला नाही." : "No chart saved for this date.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load standing charges.");
      }
      setChart(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedDate);
  }, [selectedDate]);

  const handleDateChange = (newDate: string) => {
    router.push(`/daily-work/standing-charges?date=${newDate}`);
  };

  // Map assignments on this chart by duty title and shift
  const chartAssignmentsMap = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    if (!chart) return map;
    for (const a of chart.assignments) {
      const key = `${a.dutyTitleMr || a.roleMr || ""}-${a.shift}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [chart]);

  const handleAssignPerson = async (assignmentId: number, staffId: number | null) => {
    if (!chart || chart.lifecycle === "FINALIZED") return;
    setBusy(true);
    try {
      await apiPatch(`/api/charts/${selectedDate}/assignments/${assignmentId}`, {
        staffId,
      });
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update standing charge.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-shell" lang={locale}>
      <header className="page-heading">
        <div className="heading-title">
          <h1>{locale === "mr" ? "स्टँडिंग चार्जेस (Standing Charges)" : "Standing Charges"}</h1>
          <p className="heading-desc">
            {locale === "mr"
              ? "स्थायी प्रशासकीय जबाबदाऱ्या व निवडलेल्या तारखेसाठीचे विशेष स्टँडिंग चार्जेस"
              : "Manage permanent standing charge baselines and date-specific operational roles"}
          </p>
        </div>
      </header>

      <DailyDateBar
        date={selectedDate}
        onDateChange={handleDateChange}
        lifecycle={chart?.lifecycle}
      />

      {/* Explicit Scope Clarification Banner */}
      <div className="standing-scope-banner">
        <div className="standing-scope-badge">
          {locale === "mr" ? "तारीख-विशिष्ट मोड (Date-Specific)" : "Date-Specific Mode"}
        </div>
        <p className="standing-scope-text">
          {locale === "mr"
            ? `येथे केलेले बदल केवळ दिनांक ${selectedDate} साठी लागू होतात. यामुळे कायमस्वरूपी स्टँडिंग चार्जेस किंवा इतर तारखांच्या तक्त्यांमध्ये कोणताही बदल होत नाही.`
            : `Changes made here apply only to ${selectedDate}. They will not change permanent standing charges or other chart dates.`}
        </p>
      </div>

      {loading && <p className="status-line">{locale === "mr" ? "स्टँडिंग चार्जेस लोड होत आहेत…" : "Loading standing charges…"}</p>}
      {error && <div className="status-line error" role="alert">{error}</div>}

      {chart && (
        <>
          {chart.lifecycle === "FINALIZED" && (
            <div className="status-line warning" style={{ marginBottom: 16 }}>
              {locale === "mr"
                ? "हा तक्ता अंतिम (FINALIZED) झालेला आहे. यात बदल करण्यासाठी आधी तक्ता री-ओपन करा."
                : "This chart is FINALIZED and read-only. Reopen the chart before making modifications."}
            </div>
          )}

          {/* Core Standing Charges List for this Date */}
          <section className="duty-card" style={{ marginBottom: 24 }}>
            <div className="duty-card-head">
              <h3>
                {locale === "mr"
                  ? `${selectedDate} रोजीचे प्रमुख स्टँडिंग चार्जेस`
                  : `Standing Charges for ${selectedDate}`}
              </h3>
              <Link href="/master-data?tab=duties" className="duty-link-button">
                {locale === "mr" ? "कायमस्वरूपी कर्तव्य सूची पहा →" : "View Permanent Duty Catalog →"}
              </Link>
            </div>
            <div className="duty-card-body">
              <div className="standing-charges-grid">
                {CORE_STANDING_CHARGES.map((charge, idx) => {
                  const key = `${charge.title}-${charge.shift}`;
                  const assignments = chartAssignmentsMap.get(key) || [];

                  return (
                    <div key={`${charge.title}-${charge.shift}-${idx}`} className="standing-charge-card">
                      <div className="standing-charge-header">
                        <strong>{charge.title}</strong>
                        <Badge tone="outline">
                          {charge.shift === "DAY" ? "दिवस" : "रात्र"}
                        </Badge>
                      </div>
                      <span className="standing-charge-desc">{charge.desc}</span>

                      <div className="standing-charge-assignments">
                        {assignments.length === 0 ? (
                          <span className="vacant-tag">या तारखेला नोंद नाही</span>
                        ) : (
                          assignments.map((a) => (
                            <div key={a.assignmentId} className="standing-assignment-row">
                              <span className="standing-person-name">
                                {a.person ? compactPersonLabel(a.person) : <span className="vacant-tag">रिक्त</span>}
                              </span>
                              {chart.lifecycle !== "FINALIZED" && (
                                <select
                                  className="duty-person-select"
                                  value={a.person?.staffId ?? ""}
                                  onChange={(e) => handleAssignPerson(a.assignmentId, e.target.value ? Number(e.target.value) : null)}
                                  disabled={busy}
                                >
                                  <option value="">-- रिक्त ठेवा --</option>
                                  {staffList.map((s) => (
                                    <option key={s.staffId} value={s.staffId}>
                                      {s.buckleNo ? `[${s.buckleNo}] ` : ""}{s.rankShortFormMr || s.rankCode} {s.nameMr}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
