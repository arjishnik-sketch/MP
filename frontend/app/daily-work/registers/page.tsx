"use client";

/**
 * Purpose: Dedicated Chart Registers management page.
 * Manages daily operational registers: Notices, Officer Summary, Patrol & Scan Schedule,
 * Shift Summary, Sudden Duty Changes, and Event Annexes.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiFetch, apiPost, apiPatch, apiDelete, apiPut, ApiError } from "@/lib/api";
import { localDateIso, personLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { ChartDocument, Notice, ScanRow, SuddenChange, OfficerRow } from "@/lib/types";
import { DailyDateBar } from "@/components/daily-date-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type RegisterTab = "notices" | "officers" | "scan" | "shift" | "sudden" | "events";

export default function RegistersPage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading registers…</p></div>}>
      <RegistersContent />
    </Suspense>
  );
}

function RegistersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { locale } = useLocale();

  const urlDate = searchParams.get("date");
  const today = localDateIso();
  const selectedDate = urlDate || today;

  const [activeTab, setActiveTab] = useState<RegisterTab>("notices");
  const [chart, setChart] = useState<ChartDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // New notice form state
  const [noticeGroup, setNoticeGroup] = useState("रात्रगस्त सुचना");
  const [noticeText, setNoticeText] = useState("");

  // New sudden change state
  const [changeDesc, setChangeDesc] = useState("");
  const [changeReason, setChangeReason] = useState("");

  // New scan row state
  const [scanHour, setScanHour] = useState("०९:०० ते १०:००");
  const [scanChowki, setScanChowki] = useState("मेरी पोलीस चौकी");
  const [scanStaff, setScanStaff] = useState("");

  const loadData = async (dateStr: string) => {
    setLoading(true);
    setError("");
    try {
      const chartData = await apiFetch<ChartDocument>(`/api/charts/${dateStr}`);
      setChart(chartData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(locale === "mr" ? "या तारखेचा तक्ता सापडला नाही." : "No chart saved for this date.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load chart registers.");
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
    router.push(`/daily-work/registers?date=${newDate}`);
  };

  // Add Notice
  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeText.trim() || !chart) return;
    setBusy(true);
    try {
      await apiPost(`/api/charts/${selectedDate}/notices`, {
        group: noticeGroup,
        text: noticeText.trim(),
      });
      setNoticeText("");
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add notice");
    } finally {
      setBusy(false);
    }
  };

  // Delete Notice
  const handleDeleteNotice = async (noticeId: number) => {
    if (!confirm(locale === "mr" ? "ही सूचना काढून टाकायची आहे का?" : "Delete notice?")) return;
    setBusy(true);
    try {
      await apiDelete(`/api/charts/${selectedDate}/notices/${noticeId}`);
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete notice");
    } finally {
      setBusy(false);
    }
  };

  // Add Sudden Change
  const handleAddSuddenChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeDesc.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/charts/${selectedDate}/sudden-changes`, {
        detailMr: changeDesc.trim(),
        noteMr: changeReason.trim() || null,
        changeText: changeDesc.trim(),
        reasonText: changeReason.trim(),
      });
      setChangeDesc("");
      setChangeReason("");
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add sudden change");
    } finally {
      setBusy(false);
    }
  };

  // Delete Sudden Change
  const handleDeleteSuddenChange = async (seq: number) => {
    if (!confirm(locale === "mr" ? "हा बदल काढून टाकायचा आहे का?" : "Delete sudden change?")) return;
    setBusy(true);
    try {
      await apiDelete(`/api/charts/${selectedDate}/sudden-changes/${seq}`);
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  // Add Scan Row
  const handleAddScanRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanHour || !scanChowki) return;
    setBusy(true);
    try {
      await apiPost(`/api/charts/${selectedDate}/scan-rows`, {
        sessionCode: "SCAN_HOURLY",
        sequence: chart ? chart.scanSchedule.length + 1 : 1,
        noteMr: `${scanChowki} ${scanStaff}`.trim(),
      });
      setScanStaff("");
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add scan row");
    } finally {
      setBusy(false);
    }
  };

  // Delete Scan Row
  const handleDeleteScanRow = async (seq: number) => {
    if (!confirm(locale === "mr" ? "हे स्कॅन वेळापत्रक काढून टाकायचे आहे का?" : "Delete scan row?")) return;
    setBusy(true);
    try {
      await apiDelete(`/api/charts/${selectedDate}/scan-rows/${seq}`);
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete scan row");
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: RegisterTab; label: string; count?: number }[] = [
    { id: "notices", label: locale === "mr" ? "दैनिक सूचना (Notices)" : "Notices", count: chart?.notices.length },
    { id: "officers", label: locale === "mr" ? "अधिकारी सारांश (Officers)" : "Officer Summary", count: chart?.officerSummary.length },
    { id: "scan", label: locale === "mr" ? "गस्त व स्कॅनिंग (Scan)" : "Scan Schedule", count: chart?.scanSchedule.length },
    { id: "shift", label: locale === "mr" ? "पाळी सारांश (Shifts)" : "Shift Summary", count: chart?.shiftSummaries.length },
    { id: "sudden", label: locale === "mr" ? "अचानक बदल (Changes)" : "Sudden Changes", count: chart?.suddenChanges.length },
    { id: "events", label: locale === "mr" ? "विशेष कार्यक्रम (Events)" : "Events", count: chart?.events.length },
  ];

  return (
    <div className="page-shell" lang={locale}>
      <header className="page-heading">
        <div className="heading-title">
          <h1>{locale === "mr" ? "तक्ता नोंदवह्या (Chart Registers)" : "Chart Registers"}</h1>
          <p className="heading-desc">
            {locale === "mr"
              ? "दैनिक सूचना, अधिकारी कर्तव्य सारांश, सुरक्षित नाशिक स्कॅनिंग, पाळी सारांश व अचानक बदल"
              : "Manage operational registers, directives, scan rosters, sudden changes and summaries"}
          </p>
        </div>
      </header>

      <DailyDateBar
        date={selectedDate}
        onDateChange={handleDateChange}
        lifecycle={chart?.lifecycle}
      />

      {loading && <p className="status-line">{locale === "mr" ? "नोंदवह्या लोड होत आहेत…" : "Loading registers…"}</p>}
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

          {/* Navigation Tabs */}
          <div className="duty-section-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`duty-tab-btn ${activeTab === tab.id ? "is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && tab.count > 0 && (
                  <span className="duty-tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="duty-tab-panel">
            {/* Notices Tab */}
            {activeTab === "notices" && (
              <div className="duty-groups-container">
                {chart.lifecycle !== "FINALIZED" && (
                  <div className="duty-card">
                    <div className="duty-card-head">
                      <h3>+ नवीन सूचना नोंदवा</h3>
                    </div>
                    <div className="duty-card-body">
                      <form onSubmit={handleAddNotice} className="leave-form-grid">
                        <div className="form-field">
                          <label>गट / शीर्षक (Group / Header):</label>
                          <select
                            className="duty-person-select"
                            value={noticeGroup}
                            onChange={(e) => setNoticeGroup(e.target.value)}
                          >
                            <option value="रात्रगस्त सुचना">रात्रगस्त सुचना</option>
                            <option value="गुडमॉर्निंग स्कॉड">गुडमॉर्निंग स्कॉड</option>
                            <option value="रामकुंड परिसर पेट्रोलिंग">रामकुंड परिसर पेट्रोलिंग</option>
                            <option value="महत्वाचे निर्देश">महत्वाचे निर्देश</option>
                            <option value="सूचना">सामान्य सूचना</option>
                          </select>
                        </div>
                        <div className="form-field full">
                          <label>सूचना मजकूर (Notice Text):</label>
                          <textarea
                            className="duty-text-input"
                            rows={2}
                            placeholder="सूचनेचा तपशील येथे लिहा…"
                            value={noticeText}
                            onChange={(e) => setNoticeText(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-field-actions">
                          <Button type="submit" variant="primary" disabled={busy}>
                            सूचना जोडा
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                <div className="duty-card">
                  <div className="duty-card-head">
                    <h3>सध्याच्या सूचना ({chart.notices.length})</h3>
                  </div>
                  <div className="duty-card-body">
                    {chart.notices.length === 0 ? (
                      <p className="duty-empty-msg">कोणतीही सूचना नोंदवलेली नाही.</p>
                    ) : (
                      chart.notices.map((n) => (
                        <div key={n.noticeId} className="duty-seat-row">
                          <span className="duty-seat-role">{n.groupKey || "सूचना"}</span>
                          <span className="duty-seat-person">{n.textMr}</span>
                          {chart.lifecycle !== "FINALIZED" && (
                            <button
                              type="button"
                              className="duty-delete-btn"
                              onClick={() => handleDeleteNotice(n.noticeId)}
                              disabled={busy}
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Officer Summary Tab */}
            {activeTab === "officers" && (
              <div className="duty-card">
                <div className="duty-card-head">
                  <h3>पोलीस अधिकारी कर्तव्य सारांश ({chart.officerSummary.length})</h3>
                </div>
                <div className="duty-card-body">
                  <div className="duty-table-wrap">
                    <table className="duty-table">
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>अ.क्र.</th>
                          <th>अधिकारी</th>
                          <th>कर्तव्य वाटप</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chart.officerSummary.map((off, idx) => (
                          <tr key={off.rowNo || idx}>
                            <td>{off.rowNo || idx + 1}</td>
                            <td><strong>{off.officerText}</strong></td>
                            <td>{off.dutyText || "उपस्थित"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Scan Schedule Tab */}
            {activeTab === "scan" && (
              <div className="duty-groups-container">
                {chart.lifecycle !== "FINALIZED" && (
                  <div className="duty-card">
                    <div className="duty-card-head">
                      <h3>+ स्कॅनिंग वेळ व नेमणूक जोडा</h3>
                    </div>
                    <div className="duty-card-body">
                      <form onSubmit={handleAddScanRow} className="leave-form-grid">
                        <div className="form-field">
                          <label>वेळ सत्र (Time window):</label>
                          <input
                            type="text"
                            className="duty-text-input"
                            value={scanHour}
                            onChange={(e) => setScanHour(e.target.value)}
                            placeholder="उदा. ०९:०० ते १०:००"
                            required
                          />
                        </div>
                        <div className="form-field">
                          <label>चौकी हद्द (Chowki):</label>
                          <input
                            type="text"
                            className="duty-text-input"
                            value={scanChowki}
                            onChange={(e) => setScanChowki(e.target.value)}
                            placeholder="उदा. मेरी पोलीस चौकी"
                            required
                          />
                        </div>
                        <div className="form-field">
                          <label>नियुक्त अंमलदार (Assigned Staff):</label>
                          <input
                            type="text"
                            className="duty-text-input"
                            value={scanStaff}
                            onChange={(e) => setScanStaff(e.target.value)}
                            placeholder="उदा. पोशि २३५७ साबळे"
                          />
                        </div>
                        <div className="form-field-actions">
                          <Button type="submit" variant="primary" disabled={busy}>
                            वेळापत्रक जोडा
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                <div className="duty-card">
                  <div className="duty-card-head">
                    <h3>सुरक्षित नाशिक: स्कॅनिंग वेळापत्रक ({chart.scanSchedule.length})</h3>
                  </div>
                  <div className="duty-card-body">
                    <div className="duty-table-wrap">
                      <table className="duty-table">
                        <thead>
                          <tr>
                            <th>वेळ</th>
                            <th>स्कॅन चौकी हद्द</th>
                            <th>नियुक्त अंमलदार</th>
                            {chart.lifecycle !== "FINALIZED" && <th style={{ width: 80 }}>कृती</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {chart.scanSchedule.map((row, idx) => (
                            <tr key={`${row.sessionCode}-${row.sequence}-${idx}`}>
                              <td><strong>{row.startTime ? `${row.startTime} ते ${row.endTime || ""}` : "-"}</strong></td>
                              <td>{row.location?.nameMr || row.sessionCode}</td>
                              <td>{row.person ? personLabel(row.person) : (row.noteMr || "-")}</td>
                              {chart.lifecycle !== "FINALIZED" && (
                                <td>
                                  <button
                                    type="button"
                                    className="duty-delete-btn"
                                    onClick={() => handleDeleteScanRow(row.sequence)}
                                    disabled={busy}
                                  >
                                    &times;
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Shift Summary Tab */}
            {activeTab === "shift" && (
              <div className="duty-card">
                <div className="duty-card-head">
                  <h3>पाळीनिहाय सारांश (Shift Summary)</h3>
                </div>
                <div className="duty-card-body">
                  <div className="duty-table-wrap">
                    <table className="duty-table">
                      <thead>
                        <tr>
                          <th>पाळी</th>
                          <th>घटक / तपशील</th>
                          <th>संख्या / नोंद</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chart.shiftSummaries.map((s, idx) => (
                          <tr key={`${s.summaryKey}-${s.columnKey}-${idx}`}>
                            <td><strong>{s.summaryKey === "DAY" ? "दिवसपाळी" : s.summaryKey === "NIGHT" ? "रात्रपाळी" : "इतर"}</strong></td>
                            <td>{s.columnKey}</td>
                            <td><strong>{s.valueText}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Sudden Changes Tab */}
            {activeTab === "sudden" && (
              <div className="duty-groups-container">
                {chart.lifecycle !== "FINALIZED" && (
                  <div className="duty-card">
                    <div className="duty-card-head">
                      <h3>+ अचानक बदल नोंद जोडा</h3>
                    </div>
                    <div className="duty-card-body">
                      <form onSubmit={handleAddSuddenChange} className="leave-form-grid">
                        <div className="form-field full">
                          <label>बदल तपशील (Change description):</label>
                          <input
                            type="text"
                            className="duty-text-input"
                            value={changeDesc}
                            onChange={(e) => setChangeDesc(e.target.value)}
                            placeholder="उदा. सरदार चौकी — रात्रपाळीत बंद"
                            required
                          />
                        </div>
                        <div className="form-field full">
                          <label>नोंद / कारण (Reason / details):</label>
                          <input
                            type="text"
                            className="duty-text-input"
                            value={changeReason}
                            onChange={(e) => setChangeReason(e.target.value)}
                            placeholder="उदा. कर्मचारी अपुरे; चार्ज → मालेगाव स्टँड"
                          />
                        </div>
                        <div className="form-field-actions">
                          <Button type="submit" variant="primary" disabled={busy}>
                            नोंद जोडा
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                <div className="duty-card">
                  <div className="duty-card-head">
                    <h3>अचानक बदल नोंदवही ({chart.suddenChanges.length})</h3>
                  </div>
                  <div className="duty-card-body">
                    {chart.suddenChanges.length === 0 ? (
                      <p className="duty-empty-msg">कोणताही अचानक बदल नोंदवलेला नाही.</p>
                    ) : (
                      chart.suddenChanges.map((c) => (
                        <div key={c.seq} className="duty-seat-row">
                          <span className="duty-seat-role">{c.detailMr}</span>
                          <span className="duty-seat-person">{c.noteMr || "-"}</span>
                          {chart.lifecycle !== "FINALIZED" && (
                            <button
                              type="button"
                              className="duty-delete-btn"
                              onClick={() => handleDeleteSuddenChange(c.seq)}
                              disabled={busy}
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Events Tab */}
            {activeTab === "events" && (
              <div className="duty-card">
                <div className="duty-card-head">
                  <h3>विशेष कार्यक्रम व बंदोबस्त ({chart.events.length})</h3>
                </div>
                <div className="duty-card-body">
                  {chart.events.length === 0 ? (
                    <p className="duty-empty-msg">कोणताही विशेष कार्यक्रम नोंदवलेला नाही.</p>
                  ) : (
                    chart.events.map((ev) => (
                      <div key={ev.eventId} className="duty-card" style={{ marginBottom: 12 }}>
                        <div className="duty-card-head">
                          <h4>{ev.titleMr}</h4>
                          <span className="duty-card-shift-badge">{ev.eventDate}</span>
                        </div>
                        <div className="duty-card-body">
                          <p>{ev.venueMr || ev.fallInMr || "तपशील उपलब्ध नाही"}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
