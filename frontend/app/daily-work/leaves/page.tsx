"use client";

/**
 * Purpose: Dedicated Leave & Attachments management page.
 * Ported from Durvesh's leaves.html pattern but adapted to Panchavati categories and normalized PostgreSQL schema.
 * Supports Weekly Off, Casual Leave, Earned Leave, Sick Leave, Maternity/Child Care,
 * Absenteeism, Deputation, Training, Court Pairvi, and Outstation investigations.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiFetch, apiPost, apiDelete, ApiError } from "@/lib/api";
import { localDateIso, personLabel, compactPersonLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { Availability, ChartDocument, Person } from "@/lib/types";
import { DailyDateBar } from "@/components/daily-date-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const LEAVE_CATEGORIES = [
  { key: "साप्ताहिक सुट्टी", labelMr: "साप्ताहिक सुट्टी (Weekly Off)", labelEn: "Weekly Off" },
  { key: "किरकोळ रजा", labelMr: "किरकोळ रजा (Casual Leave)", labelEn: "Casual Leave" },
  { key: "अर्जित रजा", labelMr: "अर्जित रजा (Earned Leave)", labelEn: "Earned Leave" },
  { key: "वैद्यकीय रजा", labelMr: "सिक / वैद्यकीय रजा (Sick/Medical)", labelEn: "Sick / Medical Leave" },
  { key: "प्रसुती / बाल संगोपन", labelMr: "प्रसुती / बाल संगोपन (Maternity/Child Care)", labelEn: "Maternity / Child Care" },
  { key: "गैरहजर", labelMr: "गैरहजर (Absent)", labelEn: "Absent" },
  { key: "प्रतिनियुक्ती", labelMr: "प्रतिनियुक्ती (Deputation)", labelEn: "Deputation" },
  { key: "प्रशिक्षण", labelMr: "प्रशिक्षण (Training)", labelEn: "Training" },
  { key: "कोर्ट पैरवी", labelMr: "कोर्ट पैरवी (Court Duty)", labelEn: "Court Duty" },
  { key: "स्थानिक ठाणे बाहेर / तपासकामी", labelMr: "स्थानिक ठाणे बाहेर / तपासकामी (Outstation)", labelEn: "Outstation Investigation" },
  { key: "इतर", labelMr: "इतर (Other/Special)", labelEn: "Other" },
];

export default function LeavesPage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading leave records…</p></div>}>
      <LeavesContent />
    </Suspense>
  );
}

function LeavesContent() {
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

  // New leave form state
  const [staffId, setStaffId] = useState<string>("");
  const [category, setCategory] = useState<string>("साप्ताहिक सुट्टी");
  const [startDate, setStartDate] = useState<string>(selectedDate);
  const [endDate, setEndDate] = useState<string>("");
  const [detail, setDetail] = useState<string>("");

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
      setStartDate(dateStr);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(locale === "mr" ? "या तारखेचा तक्ता सापडला नाही." : "No chart saved for this date.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load leave records.");
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
    router.push(`/daily-work/leaves?date=${newDate}`);
  };

  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) {
      alert(locale === "mr" ? "कृपया कर्मचारी निवडा." : "Please select a staff member.");
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/api/charts/${selectedDate}/availabilities`, {
        staffId: Number(staffId),
        category,
        groupKey: null,
        windowStart: startDate || null,
        windowEnd: endDate || null,
        timeStart: null,
        timeEnd: null,
        detailMr: detail.trim() || null,
        sortOrder: 0,
      });
      // Reset form
      setStaffId("");
      setEndDate("");
      setDetail("");
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add leave record.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLeave = async (availabilityId: number) => {
    if (!confirm(locale === "mr" ? "ही रजा नोंद काढून टाकायची आहे का?" : "Delete this leave record?")) return;
    setBusy(true);
    try {
      await apiDelete(`/api/charts/${selectedDate}/availabilities/${availabilityId}`);
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete leave record.");
    } finally {
      setBusy(false);
    }
  };

  const records = chart?.availability ?? [];

  return (
    <div className="page-shell" lang={locale}>
      <header className="page-heading">
        <div className="heading-title">
          <h1>{locale === "mr" ? "रजा व इतर कर्तव्ये (Leave & Attachments)" : "Leave & Attachments"}</h1>
          <p className="heading-desc">
            {locale === "mr"
              ? "साप्ताहिक सुट्टी, किरकोळ रजा, वैद्यकीय, गैरहजर, कोर्ट व बाहेरील प्रतिनियुक्ती व्यवस्थापन"
              : "Manage weekly offs, medical leaves, absences, outstation investigations, and attachments"}
          </p>
        </div>
      </header>

      <DailyDateBar
        date={selectedDate}
        onDateChange={handleDateChange}
        lifecycle={chart?.lifecycle}
      />

      {loading && <p className="status-line">{locale === "mr" ? "नोंदी लोड होत आहेत…" : "Loading records…"}</p>}
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

          {/* Add Leave Record Card */}
          {chart.lifecycle !== "FINALIZED" && (
            <section className="duty-card" style={{ marginBottom: 24 }}>
              <div className="duty-card-head">
                <h3>{locale === "mr" ? "+ नवीन रजा / अनुपलब्धता नोंदवा" : "+ Add Leave or Attachment Record"}</h3>
              </div>
              <div className="duty-card-body">
                <form onSubmit={handleAddLeave} className="leave-form-grid">
                  <div className="form-field">
                    <label>{locale === "mr" ? "कर्मचारी:" : "Staff Member:"}</label>
                    <select
                      className="duty-person-select"
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      required
                    >
                      <option value="">-- कर्मचारी निवडा --</option>
                      {staffList.map((s) => (
                        <option key={s.staffId} value={s.staffId}>
                          {s.buckleNo ? `[${s.buckleNo}] ` : ""}{s.rankShortFormMr || s.rankCode} {s.nameMr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>{locale === "mr" ? "प्रकार:" : "Type / Category:"}</label>
                    <select
                      className="duty-person-select"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      required
                    >
                      {LEAVE_CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {locale === "mr" ? c.labelMr : c.labelEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>{locale === "mr" ? "पासून (From):" : "From:"}</label>
                    <input
                      type="date"
                      className="duty-date-input"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>{locale === "mr" ? "पर्यंत (To - रिक्त असल्यास सुरु राहील):" : "To (optional):"}</label>
                    <input
                      type="date"
                      className="duty-date-input"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>

                  <div className="form-field full">
                    <label>{locale === "mr" ? "तपशील / शेरा (Remarks / Outstation place):" : "Details / Remarks:"}</label>
                    <input
                      type="text"
                      className="duty-text-input"
                      placeholder={locale === "mr" ? "उदा. गुजरात राज्य, सातारा तपास, प्रसुती रजा इ." : "e.g., Gujarat state, Satara investigation, etc."}
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                    />
                  </div>

                  <div className="form-field-actions">
                    <Button type="submit" variant="primary" disabled={busy}>
                      {busy ? (locale === "mr" ? "जतन होत आहे…" : "Saving…") : (locale === "mr" ? "नोंद जतन करा" : "Save Record")}
                    </Button>
                  </div>
                </form>
              </div>
            </section>
          )}

          {/* All Records on this Chart Date */}
          <section className="duty-card">
            <div className="duty-card-head">
              <h3>
                {locale === "mr"
                  ? `${selectedDate} रोजी नोंदवलेल्या रजा व अनुपलब्धता (${records.length})`
                  : `Leave & Attachment Records on ${selectedDate} (${records.length})`}
              </h3>
            </div>
            <div className="duty-card-body">
              {records.length === 0 ? (
                <p className="duty-empty-msg">
                  {locale === "mr" ? "या तारखेसाठी कोणतीही रजा नोंद सापडली नाही." : "No leave records for this date."}
                </p>
              ) : (
                <div className="duty-table-wrap">
                  <table className="duty-table">
                    <thead>
                      <tr>
                        <th>{locale === "mr" ? "कर्मचारी" : "Staff"}</th>
                        <th>{locale === "mr" ? "प्रकार" : "Type"}</th>
                        <th>{locale === "mr" ? "कालावधी" : "Duration"}</th>
                        <th>{locale === "mr" ? "तपशील / ठिकाण" : "Details"}</th>
                        {chart.lifecycle !== "FINALIZED" && <th style={{ width: 80 }}>{locale === "mr" ? "कृती" : "Action"}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => {
                        const timing = r.windowStart || r.windowEnd
                          ? `${r.windowStart || ""} ते ${r.windowEnd || "पुढे"}`
                          : "नियमित";
                        return (
                          <tr key={r.availabilityId}>
                            <td>
                              <strong>{r.person ? compactPersonLabel(r.person) : "कर्मचारी माहिती नाही"}</strong>
                            </td>
                            <td>
                              <Badge tone="outline">{r.category}</Badge>
                            </td>
                            <td>{timing}</td>
                            <td>{r.detailMr || "-"}</td>
                            {chart.lifecycle !== "FINALIZED" && (
                              <td>
                                <button
                                  type="button"
                                  className="duty-delete-btn"
                                  onClick={() => handleDeleteLeave(r.availabilityId)}
                                  disabled={busy}
                                  title="काढून टाका"
                                >
                                  &times;
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
