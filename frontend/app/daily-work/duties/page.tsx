"use client";

/**
 * Purpose: Menu-driven daily duty assignment workspace (Assign & Manage Duties).
 * Allows the clerk to view and assign daily duty charges across Command, Day, Night,
 * Chowkis, Office, Court/Special, and Notices tabs.
 * Replaces pure inline chart editing with a structured, operational interface.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, apiPatch, apiPost, apiDelete, ApiError } from "@/lib/api";
import { localDateIso, personLabel, compactPersonLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { Assignment, ChartDocument, Person, Shift } from "@/lib/types";
import { buildDocumentLayout, type DutyGroup } from "@/lib/chart-document-layout";
import { DailyDateBar } from "@/components/daily-date-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type TabId = "command" | "day" | "night" | "chowkis" | "office" | "court" | "notices";

export default function AssignDutiesPage() {
  return (
    <Suspense fallback={<div className="page-shell"><p>Loading duties workspace…</p></div>}>
      <AssignDutiesContent />
    </Suspense>
  );
}

function AssignDutiesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { locale, t } = useLocale();

  const urlDate = searchParams.get("date");
  const today = localDateIso();
  const selectedDate = urlDate || today;

  const [activeTab, setActiveTab] = useState<TabId>("day");
  const [chart, setChart] = useState<ChartDocument | null>(null);
  const [staffList, setStaffList] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Search filter inside active tab
  const [staffFilter, setStaffFilter] = useState("");

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
        setError(err instanceof Error ? err.message : "Failed to load duty data.");
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
    router.push(`/daily-work/duties?date=${newDate}`);
  };

  const layout = useMemo(() => (chart ? buildDocumentLayout(chart) : null), [chart]);

  // Handle reassigning a slot to a person or clearing to रिक्त
  const handleAssignPerson = async (assignmentId: number, staffId: number | null, isBima?: boolean) => {
    if (!chart || chart.lifecycle === "FINALIZED") return;
    setBusy(true);
    try {
      await apiPatch(`/api/charts/${selectedDate}/assignments/${assignmentId}`, {
        staffId,
        isBima,
      });
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Assignment update failed");
    } finally {
      setBusy(false);
    }
  };

  // Toggle BIMA
  const handleToggleBima = async (assignment: Assignment) => {
    if (!chart || chart.lifecycle === "FINALIZED" || !assignment.person) return;
    setBusy(true);
    try {
      await apiPatch(`/api/charts/${selectedDate}/assignments/${assignment.assignmentId}`, {
        staffId: assignment.person.staffId,
        isBima: !assignment.isBima,
      });
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "BIMA update failed");
    } finally {
      setBusy(false);
    }
  };

  // Add seat to group
  const handleAddSeat = async (dutyTitleMr: string, shift: Shift, columnNo: number) => {
    if (!chart || chart.lifecycle === "FINALIZED") return;
    setBusy(true);
    try {
      await apiPost(`/api/charts/${selectedDate}/assignments`, {
        dutyTitleMr,
        shift,
        columnNo,
        allocationState: "VACANT_RIKT",
      });
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Adding seat failed");
    } finally {
      setBusy(false);
    }
  };

  // Delete seat
  const handleDeleteSeat = async (assignmentId: number) => {
    if (!chart || chart.lifecycle === "FINALIZED") return;
    if (!confirm(locale === "mr" ? "ही जागा काढून टाकायची आहे का?" : "Delete this duty seat?")) return;
    setBusy(true);
    try {
      await apiDelete(`/api/charts/${selectedDate}/assignments/${assignmentId}`);
      await loadData(selectedDate);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Deleting seat failed");
    } finally {
      setBusy(false);
    }
  };

  // Filtered staff for person pickers
  const availableStaff = useMemo(() => {
    if (!staffFilter.trim()) return staffList;
    const q = staffFilter.toLowerCase().trim();
    return staffList.filter(
      (s) =>
        s.nameMr?.toLowerCase().includes(q) ||
        s.buckleNo?.toLowerCase().includes(q) ||
        s.rankCode?.toLowerCase().includes(q)
    );
  }, [staffList, staffFilter]);

  // Total stats for the date bar
  const stats = useMemo(() => {
    if (!chart) return undefined;
    const total = chart.assignments.length;
    const filled = chart.assignments.filter((a) => a.person !== null).length;
    return {
      totalSeats: total,
      filledSeats: filled,
      vacantSeats: total - filled,
    };
  }, [chart]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "command", label: locale === "mr" ? "कमांड व प्रमुख" : "Command", count: layout ? (layout.senior ? 1 : 0) + layout.principals.length : 0 },
    { id: "day", label: locale === "mr" ? "दिवस पाळी" : "Day Duty", count: layout?.station.filter((g) => g.shift === "DAY").length },
    { id: "night", label: locale === "mr" ? "रात्र पाळी" : "Night Duty", count: layout?.station.filter((g) => g.shift === "NIGHT").length },
    { id: "chowkis", label: locale === "mr" ? "पोलीस चौक्या" : "Chowkis", count: layout?.chowkis.length },
    { id: "office", label: locale === "mr" ? "कार्यालयीन शाखा" : "Office", count: layout?.officeCore.length },
    { id: "court", label: locale === "mr" ? "कोर्ट / विशेष" : "Court / Special", count: layout?.specialDuties.length },
    { id: "notices", label: locale === "mr" ? "सूचना व निर्देश" : "Notices", count: chart?.notices.length },
  ];

  return (
    <div className="page-shell" lang={locale}>
      <header className="page-heading">
        <div className="heading-title">
          <h1>{locale === "mr" ? "कर्तव्य वाटप व व्यवस्थापन" : "Assign & Manage Duties"}</h1>
          <p className="heading-desc">
            {locale === "mr"
              ? "दैनंदिन कर्तव्य वाटप, जागा भरणे, रिक्त करणे आणि बिमा नोंद"
              : "Assign personnel, manage vacancies, add/remove seats and configure daily duties"}
          </p>
        </div>
      </header>

      <DailyDateBar
        date={selectedDate}
        onDateChange={handleDateChange}
        lifecycle={chart?.lifecycle}
        stats={stats}
      />

      {loading && <p className="status-line">{locale === "mr" ? "कर्तव्य माहिती लोड होत आहे…" : "Loading duty records…"}</p>}
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

          {/* Staff Filter Search */}
          <div className="duty-filter-bar">
            <input
              type="text"
              placeholder={locale === "mr" ? "कर्मचारी शोधा (नाव, बक्कल क्र., हुद्दा)…" : "Search staff to assign (name, buckle, rank)…"}
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="duty-staff-search"
            />
            {staffFilter && (
              <Button size="sm" variant="outline" onClick={() => setStaffFilter("")}>
                Clear
              </Button>
            )}
          </div>

          {/* Tab Content */}
          <div className="duty-tab-panel">
            {activeTab === "command" && layout && (
              <div className="duty-groups-container">
                {/* Senior PI */}
                <div className="duty-card">
                  <div className="duty-card-head">
                    <h3>ठाणे प्रमुख (वरिष्ठ पोलीस निरीक्षक)</h3>
                  </div>
                  <div className="duty-card-body">
                    <div className="duty-seat-row">
                      <span className="duty-seat-role">वरिष्ठ पोलीस निरीक्षक</span>
                      <span className="duty-seat-person">
                        {layout.senior?.person ? personLabel(layout.senior.person) : <span className="vacant-tag">रिक्त</span>}
                      </span>
                      {chart.lifecycle !== "FINALIZED" && layout.senior && (
                        <div className="duty-seat-actions">
                          <select
                            className="duty-person-select"
                            value={layout.senior.person?.staffId ?? ""}
                            onChange={(e) => handleAssignPerson(layout.senior!.assignmentId, e.target.value ? Number(e.target.value) : null)}
                            disabled={busy}
                          >
                            <option value="">-- रिक्त ठेवा --</option>
                            {availableStaff.map((s) => (
                              <option key={s.staffId} value={s.staffId}>
                                {s.buckleNo ? `[${s.buckleNo}] ` : ""}{s.rankShortFormMr || s.rankCode} {s.nameMr}
                              </option>
                            ))}
                          </select>
                          {layout.senior.person && (
                            <Button size="sm" variant="outline" onClick={() => handleAssignPerson(layout.senior!.assignmentId, null)} disabled={busy}>
                              रिक्त करा
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Principal Officers */}
                {layout.principals.map((officer) => (
                  <div key={officer.branch} className="duty-card">
                    <div className="duty-card-head">
                      <h3>{officer.branch}</h3>
                    </div>
                    <div className="duty-card-body">
                      {officer.assignment && (
                        <div className="duty-seat-row">
                          <span className="duty-seat-role">{officer.assignment.roleMr || "पोलीस निरीक्षक"}</span>
                          <span className="duty-seat-person">
                            {officer.assignment.person ? personLabel(officer.assignment.person) : <span className="vacant-tag">रिक्त</span>}
                          </span>
                          {chart.lifecycle !== "FINALIZED" && (
                            <div className="duty-seat-actions">
                              <select
                                className="duty-person-select"
                                value={officer.assignment.person?.staffId ?? ""}
                                onChange={(e) => handleAssignPerson(officer.assignment!.assignmentId, e.target.value ? Number(e.target.value) : null)}
                                disabled={busy}
                              >
                                <option value="">-- रिक्त ठेवा --</option>
                                {availableStaff.map((s) => (
                                  <option key={s.staffId} value={s.staffId}>
                                    {s.buckleNo ? `[${s.buckleNo}] ` : ""}{s.rankShortFormMr || s.rankCode} {s.nameMr}
                                  </option>
                                ))}
                              </select>
                              {officer.assignment.person && (
                                <Button size="sm" variant="outline" onClick={() => handleAssignPerson(officer.assignment!.assignmentId, null)} disabled={busy}>
                                  रिक्त करा
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Day Duty Tab */}
            {activeTab === "day" && layout && (
              <DutyGroupList
                groups={layout.station.filter((g) => g.shift === "DAY")}
                availableStaff={availableStaff}
                onAssign={handleAssignPerson}
                onToggleBima={handleToggleBima}
                onAddSeat={handleAddSeat}
                onDeleteSeat={handleDeleteSeat}
                disabled={chart.lifecycle === "FINALIZED" || busy}
                shift="DAY"
                defaultColumnNo={2}
              />
            )}

            {/* Night Duty Tab */}
            {activeTab === "night" && layout && (
              <DutyGroupList
                groups={layout.station.filter((g) => g.shift === "NIGHT")}
                availableStaff={availableStaff}
                onAssign={handleAssignPerson}
                onToggleBima={handleToggleBima}
                onAddSeat={handleAddSeat}
                onDeleteSeat={handleDeleteSeat}
                disabled={chart.lifecycle === "FINALIZED" || busy}
                shift="NIGHT"
                defaultColumnNo={3}
              />
            )}

            {/* Chowkis Tab */}
            {activeTab === "chowkis" && layout && (
              <div className="duty-groups-container">
                {layout.chowkis.map((block) => (
                  <div key={block.location.code} className="duty-card">
                    <div className="duty-card-head">
                      <h3>{block.location.nameMr}</h3>
                    </div>
                    <div className="duty-card-body">
                      {block.groups.map((group) => (
                        <DutyGroupItem
                          key={`${group.title}-${group.shift}`}
                          group={group}
                          availableStaff={availableStaff}
                          onAssign={handleAssignPerson}
                          onToggleBima={handleToggleBima}
                          onAddSeat={handleAddSeat}
                          onDeleteSeat={handleDeleteSeat}
                          disabled={chart.lifecycle === "FINALIZED" || busy}
                          shift={group.shift}
                          defaultColumnNo={group.columnNo}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Office Tab */}
            {activeTab === "office" && layout && (
              <DutyGroupList
                groups={layout.officeCore}
                availableStaff={availableStaff}
                onAssign={handleAssignPerson}
                onToggleBima={handleToggleBima}
                onAddSeat={handleAddSeat}
                onDeleteSeat={handleDeleteSeat}
                disabled={chart.lifecycle === "FINALIZED" || busy}
                shift="DAY"
                defaultColumnNo={4}
              />
            )}

            {/* Court / Special Tab */}
            {activeTab === "court" && layout && (
              <DutyGroupList
                groups={layout.specialDuties}
                availableStaff={availableStaff}
                onAssign={handleAssignPerson}
                onToggleBima={handleToggleBima}
                onAddSeat={handleAddSeat}
                onDeleteSeat={handleDeleteSeat}
                disabled={chart.lifecycle === "FINALIZED" || busy}
                shift="DAY"
                defaultColumnNo={8}
              />
            )}

            {/* Notices Tab */}
            {activeTab === "notices" && (
              <div className="duty-groups-container">
                <div className="duty-card">
                  <div className="duty-card-head">
                    <h3>{locale === "mr" ? "दैनिक व रात्रगस्त सूचना" : "Daily & Night Notices"}</h3>
                  </div>
                  <div className="duty-card-body">
                    {chart.notices.length === 0 ? (
                      <p className="duty-empty-msg">{locale === "mr" ? "कोणतीही सूचना नोंदवलेली नाही." : "No notices recorded for this chart."}</p>
                    ) : (
                      chart.notices.map((n) => (
                        <div key={n.noticeId} className="duty-seat-row">
                          <span className="duty-seat-role">{n.groupKey || "सूचना"}</span>
                          <span className="duty-seat-person">{n.textMr}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DutyGroupList({
  groups,
  availableStaff,
  onAssign,
  onToggleBima,
  onAddSeat,
  onDeleteSeat,
  disabled,
  shift,
  defaultColumnNo,
}: {
  groups: DutyGroup[];
  availableStaff: Person[];
  onAssign: (assignmentId: number, staffId: number | null, isBima?: boolean) => void;
  onToggleBima: (assignment: Assignment) => void;
  onAddSeat: (title: string, shift: Shift, col: number) => void;
  onDeleteSeat: (assignmentId: number) => void;
  disabled: boolean;
  shift: Shift;
  defaultColumnNo: number;
}) {
  return (
    <div className="duty-groups-container">
      {groups.length === 0 ? (
        <p className="duty-empty-msg">कोणतीही कर्तव्य नोंद नाही.</p>
      ) : (
        groups.map((group) => (
          <DutyGroupItem
            key={`${group.title}-${group.shift}-${group.columnNo}`}
            group={group}
            availableStaff={availableStaff}
            onAssign={onAssign}
            onToggleBima={onToggleBima}
            onAddSeat={onAddSeat}
            onDeleteSeat={onDeleteSeat}
            disabled={disabled}
            shift={shift}
            defaultColumnNo={defaultColumnNo}
          />
        ))
      )}
    </div>
  );
}

function DutyGroupItem({
  group,
  availableStaff,
  onAssign,
  onToggleBima,
  onAddSeat,
  onDeleteSeat,
  disabled,
  shift,
  defaultColumnNo,
}: {
  group: DutyGroup;
  availableStaff: Person[];
  onAssign: (assignmentId: number, staffId: number | null, isBima?: boolean) => void;
  onToggleBima: (assignment: Assignment) => void;
  onAddSeat: (title: string, shift: Shift, col: number) => void;
  onDeleteSeat: (assignmentId: number) => void;
  disabled: boolean;
  shift: Shift;
  defaultColumnNo: number;
}) {
  return (
    <div className="duty-card">
      <div className="duty-card-head">
        <div>
          <h3>{group.title}</h3>
          <span className="duty-card-shift-badge">
            {group.shift === "DAY" ? "दिवस (०९:०० - २१:००)" : "रात्र (२१:०० - ०९:००)"}
          </span>
        </div>
        {!disabled && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddSeat(group.title, group.shift || shift, group.columnNo || defaultColumnNo)}
          >
            + जागा जोडा
          </Button>
        )}
      </div>
      <div className="duty-card-body">
        {group.rows.map((row) => (
          <div key={row.assignmentId} className="duty-seat-row">
            <span className="duty-seat-role">{row.roleMr || row.dutyTitleMr || "अंमलदार"}</span>
            <div className="duty-seat-person-wrapper">
              {row.person ? (
                <span className="duty-seat-person">
                  {compactPersonLabel(row.person)}
                </span>
              ) : (
                <span className="vacant-tag">रिक्त</span>
              )}
              {row.isBima && <span className="bima-chip">बिमा</span>}
            </div>

            {!disabled && (
              <div className="duty-seat-actions">
                <select
                  className="duty-person-select"
                  value={row.person?.staffId ?? ""}
                  onChange={(e) => onAssign(row.assignmentId, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">-- रिक्त ठेवा --</option>
                  {availableStaff.map((s) => (
                    <option key={s.staffId} value={s.staffId}>
                      {s.buckleNo ? `[${s.buckleNo}] ` : ""}{s.rankShortFormMr || s.rankCode} {s.nameMr}
                    </option>
                  ))}
                </select>

                {row.person && (
                  <>
                    <button
                      type="button"
                      className={`duty-bima-btn ${row.isBima ? "is-bima" : ""}`}
                      onClick={() => onToggleBima(row)}
                      title="बिमा टॅग टॉगल करा"
                    >
                      बिमा
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAssign(row.assignmentId, null)}
                    >
                      रिक्त
                    </Button>
                  </>
                )}

                <button
                  type="button"
                  className="duty-delete-btn"
                  onClick={() => onDeleteSeat(row.assignmentId)}
                  title="जागा काढा"
                >
                  &times;
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
