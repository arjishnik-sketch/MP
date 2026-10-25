"use client";

/**
 * Purpose: Authoring and management dialogs for chart registers and seats.
 * Current role: Exposes narrow REST CRUD for scan schedule, officer duty,
 * shift summary, sudden changes, special events, and seat creation.
 * Constraint: Clerk explicitly chooses all personnel; all mutations lock
 * the chart and enforce draft lifecycle.
 */

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiFetch, apiPatch, apiPost, apiPut } from "@/lib/api";
import type {
  EventRecord,
  MastersResponse,
  OfficerRow,
  Person,
  ScanRow,
  Shift,
  ShiftSummary,
  StaffMaster,
  SuddenChange,
} from "@/lib/types";
import { personLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function staffMasterPerson(staff: StaffMaster): Person {
  return {
    staffId: staff.staff_id,
    nameMr: staff.name_mr,
    rankCode: staff.rank_code,
    buckleNo: staff.buckle_no,
  };
}

function staffOptionLabel(staff: StaffMaster): string {
  const person = staffMasterPerson(staff);
  return `${personLabel(person)}${staff.active ? "" : " (inactive)"}`;
}

// -----------------------------------------------------------------------------
// 1. Scan Schedule Row Dialog
// -----------------------------------------------------------------------------

export interface ScanRowDialogProps {
  date: string;
  row: ScanRow | null;
  defaultSequence: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ScanRowDialog({
  date,
  row,
  defaultSequence,
  open,
  onOpenChange,
  onSaved,
}: ScanRowDialogProps) {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [sessionCode, setSessionCode] = useState(row?.sessionCode ?? "SCAN_HOURLY");
  const [sequence, setSequence] = useState(String(row?.sequence ?? defaultSequence));
  const [startTime, setStartTime] = useState(row?.startTime?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(row?.endTime?.slice(0, 5) ?? "");
  const [locationId, setLocationId] = useState(row?.location ? String(row.location.locationId) : "");
  const [staffId, setStaffId] = useState(row?.person ? String(row.person.staffId) : "");
  const [noteMr, setNoteMr] = useState(row?.noteMr ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSessionCode(row?.sessionCode ?? "SCAN_HOURLY");
    setSequence(String(row?.sequence ?? defaultSequence));
    setStartTime(row?.startTime?.slice(0, 5) ?? "");
    setEndTime(row?.endTime?.slice(0, 5) ?? "");
    setLocationId(row?.location ? String(row.location.locationId) : "");
    setStaffId(row?.person ? String(row.person.staffId) : "");
    setNoteMr(row?.noteMr ?? "");
    setError("");

    let active = true;
    apiFetch<MastersResponse>("/api/masters")
      .then((data) => {
        if (active) setMasters(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, row, defaultSequence]);

  const save = async () => {
    const seq = Number(sequence);
    if (!Number.isInteger(seq) || seq <= 0) {
      setError("अ.क्र. (Sequence) वैध क्रमांक असणे आवश्यक आहे.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        sessionCode: sessionCode.trim() || "SCAN_HOURLY",
        sequence: seq,
        startTime: startTime || null,
        endTime: endTime || null,
        locationId: locationId ? Number(locationId) : null,
        staffId: staffId ? Number(staffId) : null,
        noteMr: noteMr.trim() || null,
      };

      if (row) {
        await apiPatch(
          `/api/charts/${date}/scan-rows/${encodeURIComponent(row.sessionCode)}/${row.sequence}`,
          payload,
        );
      } else {
        await apiPost(`/api/charts/${date}/scan-rows`, payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "नोंद जतन अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!row || !window.confirm("ही गस्त नोंद हटवायची आहे का?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(
        `/api/charts/${date}/scan-rows/${encodeURIComponent(row.sessionCode)}/${row.sequence}`,
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "नोंद हटवणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{row ? "गस्त नोंद संपादन" : "नवीन गस्त नोंद जोडा"}</DialogTitle>
          <DialogDescription>
            सुरक्षित नाशिक: गस्त व स्कॅनिंग वेळापत्रकातील नोंद स्पष्टपणे भरा.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="scan-session">सत्र कोड (Session Code) *</label>
              <input
                id="scan-session"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value)}
                placeholder="SCAN_HOURLY"
                disabled={busy || Boolean(row)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="scan-seq">अ.क्र. (Seq) *</label>
              <input
                id="scan-seq"
                type="number"
                value={sequence}
                onChange={(e) => setSequence(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="scan-start">सुरुवात वेळ</label>
              <input
                id="scan-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="scan-end">समाप्ती वेळ</label>
              <input
                id="scan-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="scan-location">चौकी / ठिकाण</label>
              <select
                id="scan-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">निवड नाही / रिक्त</option>
                {masters?.locations.map((loc) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    {loc.name_mr} ({loc.location_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="scan-staff">कर्मचारी</label>
              <select
                id="scan-staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">रिक्त / जागा रिकामी</option>
                {masters?.staff.map((st) => (
                  <option key={st.staff_id} value={st.staff_id}>
                    {staffOptionLabel(st)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field full">
              <label htmlFor="scan-notes">नोंद (Notes)</label>
              <input
                id="scan-notes"
                value={noteMr}
                onChange={(e) => setNoteMr(e.target.value)}
                placeholder="उदा. बिट मार्शल / कार्यालयीन वाहन"
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {row && (
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>
                  नोंद हटवा
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                रद्द करा
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>
                {busy ? "जतन होत आहे…" : "जतन करा"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 2. Officer Summary Row Dialog
// -----------------------------------------------------------------------------

export interface OfficerSummaryDialogProps {
  date: string;
  row: OfficerRow | null;
  defaultRowNo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function OfficerSummaryDialog({
  date,
  row,
  defaultRowNo,
  open,
  onOpenChange,
  onSaved,
}: OfficerSummaryDialogProps) {
  const [rowNo, setRowNo] = useState(String(row?.rowNo ?? defaultRowNo));
  const [officerText, setOfficerText] = useState(row?.officerText ?? "");
  const [dutyText, setDutyText] = useState(row?.dutyText ?? "");
  const [source, setSource] = useState<"SOURCE" | "OVERRIDE" | "SUGGESTION">(row?.source ?? "OVERRIDE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRowNo(String(row?.rowNo ?? defaultRowNo));
    setOfficerText(row?.officerText ?? "");
    setDutyText(row?.dutyText ?? "");
    setSource(row?.source ?? "OVERRIDE");
    setError("");
  }, [open, row, defaultRowNo]);

  const save = async () => {
    const num = Number(rowNo);
    if (!Number.isInteger(num) || num <= 0) {
      setError("अ.क्र. वैध क्रमांक असणे आवश्यक आहे.");
      return;
    }
    if (!officerText.trim()) {
      setError("अधिकाऱ्याचे नाव आवश्यक आहे.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/charts/${date}/officer-summary`, {
        rowNo: num,
        officerText: officerText.trim(),
        dutyText: dutyText.trim() || null,
        source,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "अधिकारी नोंद जतन अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!row || !window.confirm("ही अधिकारी नोंद हटवायची आहे का?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(`/api/charts/${date}/officer-summary/${row.rowNo}`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "अधिकारी नोंद हटवणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{row ? "अधिकारी कर्तव्य नोंद संपादन" : "नवीन अधिकारी नोंद जोडा"}</DialogTitle>
          <DialogDescription>
            दुसऱ्या पानावरील अधिकारी कर्तव्य नोंद वहीतील नोंद भरा.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="officer-row-no">अ.क्र. *</label>
              <input
                id="officer-row-no"
                type="number"
                value={rowNo}
                onChange={(e) => setRowNo(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="officer-source">स्रोत (Source)</label>
              <select
                id="officer-source"
                value={source}
                onChange={(e) => setSource(e.target.value as "SOURCE" | "OVERRIDE" | "SUGGESTION")}
                disabled={busy}
              >
                <option value="OVERRIDE">OVERRIDE (नोंदणीकृत)</option>
                <option value="SOURCE">SOURCE (मूळ तक्ता)</option>
                <option value="SUGGESTION">SUGGESTION (सुचवलेले)</option>
              </select>
            </div>
            <div className="form-field full">
              <label htmlFor="officer-name">अधिकारी (Officer) *</label>
              <input
                id="officer-name"
                value={officerText}
                onChange={(e) => setOfficerText(e.target.value)}
                placeholder="उदा. पोउपनि / पाटील एस. बी."
                disabled={busy}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="officer-duty">कर्तव्य (Duty Details)</label>
              <textarea
                id="officer-duty"
                value={dutyText}
                onChange={(e) => setDutyText(e.target.value)}
                placeholder="उदा. रात्र गस्त अधिकारी / स्टेशन डायरी अंमलदार"
                disabled={busy}
                rows={3}
                style={{ resize: "vertical", width: "100%" }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {row && (
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>
                  नोंद हटवा
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                रद्द करा
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>
                {busy ? "जतन होत आहे…" : "जतन करा"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 3. Shift Summary Dialog
// -----------------------------------------------------------------------------

export interface ShiftSummaryDialogProps {
  date: string;
  summary: ShiftSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ShiftSummaryDialog({
  date,
  summary,
  open,
  onOpenChange,
  onSaved,
}: ShiftSummaryDialogProps) {
  const [summaryKey, setSummaryKey] = useState<"DAY" | "NIGHT" | "OTHER">(summary?.summaryKey ?? "DAY");
  const [columnKey, setColumnKey] = useState(summary?.columnKey ?? "");
  const [valueText, setValueText] = useState(summary?.valueText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSummaryKey(summary?.summaryKey ?? "DAY");
    setColumnKey(summary?.columnKey ?? "");
    setValueText(summary?.valueText ?? "");
    setError("");
  }, [open, summary]);

  const save = async () => {
    if (!columnKey.trim()) {
      setError("स्तंभ / घटक नाव आवश्यक आहे.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiPut(`/api/charts/${date}/shift-summary`, {
        summaryKey,
        columnKey: columnKey.trim(),
        valueText: valueText.trim(),
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "पाळी सारांश जतन अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!summary || !window.confirm("ही सारांश नोंद हटवायची आहे का?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(
        `/api/charts/${date}/shift-summary/${summary.summaryKey}/${encodeURIComponent(summary.columnKey)}`,
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "सारांश हटवणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{summary ? "पाळीनिहाय सारांश संपादन" : "नवीन सारांश नोंद जोडा"}</DialogTitle>
          <DialogDescription>
            पाळीनिहाय मनुष्यबळ सारांश नोंद भरा.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="shift-summary-key">पाळी (Shift) *</label>
              <select
                id="shift-summary-key"
                value={summaryKey}
                onChange={(e) => setSummaryKey(e.target.value as "DAY" | "NIGHT" | "OTHER")}
                disabled={busy || Boolean(summary)}
              >
                <option value="DAY">दिवसपाळी (DAY)</option>
                <option value="NIGHT">रात्रपाळी (NIGHT)</option>
                <option value="OTHER">इतर (OTHER)</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="shift-summary-col">स्तंभ / घटक नाव *</label>
              <input
                id="shift-summary-col"
                value={columnKey}
                onChange={(e) => setColumnKey(e.target.value)}
                placeholder="उदा. हजर, रजा, एकंदर"
                disabled={busy || Boolean(summary)}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="shift-summary-val">मूल्य / संख्या (Value) *</label>
              <input
                id="shift-summary-val"
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
                placeholder="उदा. ४२"
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {summary && (
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>
                  नोंद हटवा
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                रद्द करा
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>
                {busy ? "जतन होत आहे…" : "जतन करा"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 4. Sudden Duty Changes Dialog
// -----------------------------------------------------------------------------

export interface SuddenChangeDialogProps {
  date: string;
  change: SuddenChange | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function SuddenChangeDialog({
  date,
  change,
  open,
  onOpenChange,
  onSaved,
}: SuddenChangeDialogProps) {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [originalStaffId, setOriginalStaffId] = useState(change?.original ? String(change.original.staffId) : "");
  const [replacementStaffId, setReplacementStaffId] = useState(change?.replacement ? String(change.replacement.staffId) : "");
  const [detailMr, setDetailMr] = useState(change?.detailMr ?? "");
  const [noteMr, setNoteMr] = useState(change?.noteMr ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setOriginalStaffId(change?.original ? String(change.original.staffId) : "");
    setReplacementStaffId(change?.replacement ? String(change.replacement.staffId) : "");
    setDetailMr(change?.detailMr ?? "");
    setNoteMr(change?.noteMr ?? "");
    setError("");

    let active = true;
    apiFetch<MastersResponse>("/api/masters")
      .then((data) => {
        if (active) setMasters(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, change]);

  const save = async () => {
    if (!detailMr.trim()) {
      setError("कारण मीमांसा आवश्यक आहे.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        originalStaffId: originalStaffId ? Number(originalStaffId) : null,
        replacementStaffId: replacementStaffId ? Number(replacementStaffId) : null,
        detailMr: detailMr.trim(),
        noteMr: noteMr.trim() || null,
      };

      if (change) {
        await apiPatch(`/api/charts/${date}/sudden-changes/${change.seq}`, payload);
      } else {
        await apiPost(`/api/charts/${date}/sudden-changes`, payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "अचानक बदल नोंद जतन अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!change || !window.confirm("ही बदल नोंद हटवायची आहे का?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(`/api/charts/${date}/sudden-changes/${change.seq}`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "नोंद हटवणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{change ? "अचानक कर्तव्य बदल संपादन" : "अचानक कर्तव्य बदल नोंदवा"}</DialogTitle>
          <DialogDescription>
            दिवसा दरम्यान झालेल्या अचानक बदलाची स्पष्ट कारणमीमांसा नोंदवा.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="sudden-orig">मूळ कर्मचारी (Original)</label>
              <select
                id="sudden-orig"
                value={originalStaffId}
                onChange={(e) => setOriginalStaffId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">रिक्त / निवड नाही</option>
                {masters?.staff.map((st) => (
                  <option key={st.staff_id} value={st.staff_id}>
                    {staffOptionLabel(st)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="sudden-repl">बदली कर्मचारी (Replacement)</label>
              <select
                id="sudden-repl"
                value={replacementStaffId}
                onChange={(e) => setReplacementStaffId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">रिक्त / निवड नाही</option>
                {masters?.staff.map((st) => (
                  <option key={st.staff_id} value={st.staff_id}>
                    {staffOptionLabel(st)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field full">
              <label htmlFor="sudden-detail">कारण मीमांसा (Reason) *</label>
              <textarea
                id="sudden-detail"
                value={detailMr}
                onChange={(e) => setDetailMr(e.target.value)}
                placeholder="उदा. आजारी रजा मंजूर झाल्याने त्यांच्या जागी नेमणूक"
                disabled={busy}
                rows={3}
                style={{ resize: "vertical", width: "100%" }}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="sudden-note">नोंद (Notes)</label>
              <input
                id="sudden-note"
                value={noteMr}
                onChange={(e) => setNoteMr(e.target.value)}
                placeholder="अतिरिक्त संदर्भ"
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {change && (
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>
                  नोंद हटवा
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                रद्द करा
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>
                {busy ? "जतन होत आहे…" : "जतन करा"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 5. Special Event Dialog
// -----------------------------------------------------------------------------

export interface EventDialogProps {
  date: string;
  event: EventRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EventDialog({
  date,
  event,
  open,
  onOpenChange,
  onSaved,
}: EventDialogProps) {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [titleMr, setTitleMr] = useState(event?.titleMr ?? "");
  const [eventDate, setEventDate] = useState(event?.eventDate ?? date);
  const [startTime, setStartTime] = useState(event?.startTime?.slice(0, 5) ?? "");
  const [venueMr, setVenueMr] = useState(event?.venueMr ?? "");
  const [fallInMr, setFallInMr] = useState(event?.fallInMr ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Assignment adding state inside existing event
  const [assignStaffId, setAssignStaffId] = useState("");
  const [assignRoleMr, setAssignRoleMr] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitleMr(event?.titleMr ?? "");
    setEventDate(event?.eventDate ?? date);
    setStartTime(event?.startTime?.slice(0, 5) ?? "");
    setVenueMr(event?.venueMr ?? "");
    setFallInMr(event?.fallInMr ?? "");
    setError("");

    let active = true;
    apiFetch<MastersResponse>("/api/masters")
      .then((data) => {
        if (active) setMasters(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, event, date]);

  const saveEvent = async () => {
    if (!titleMr.trim()) {
      setError("कार्यक्रमाचे शीर्षक आवश्यक आहे.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        titleMr: titleMr.trim(),
        eventDate: eventDate || date,
        startTime: startTime || null,
        venueMr: venueMr.trim() || null,
        fallInMr: fallInMr.trim() || null,
      };

      if (event) {
        await apiPatch(`/api/charts/${date}/events/${event.eventId}`, payload);
      } else {
        await apiPost(`/api/charts/${date}/events`, payload);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "कार्यक्रम जतन अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async () => {
    if (!event || !window.confirm("हा संपूर्ण विशेष कार्यक्रम हटवायचा आहे का?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(`/api/charts/${date}/events/${event.eventId}`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "कार्यक्रम हटवणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  const addAssignment = async () => {
    if (!event) return;
    if (!assignStaffId) {
      setError("कर्मचारी निवडणे आवश्यक आहे.");
      return;
    }
    setAssignBusy(true);
    setError("");
    try {
      await apiPost(`/api/charts/${date}/events/${event.eventId}/assignments`, {
        staffId: Number(assignStaffId),
        roleMr: assignRoleMr.trim() || null,
      });
      setAssignStaffId("");
      setAssignRoleMr("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "कर्मचारी नेमणूक अयशस्वी.");
    } finally {
      setAssignBusy(false);
    }
  };

  const removeAssignment = async (staffId: number) => {
    if (!event) return;
    setAssignBusy(true);
    setError("");
    try {
      await apiDelete(`/api/charts/${date}/events/${event.eventId}/assignments/${staffId}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "नेमणूक काढणे अयशस्वी.");
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{event ? "विशेष कार्यक्रम संपादन" : "नवीन विशेष कार्यक्रम जोडा"}</DialogTitle>
          <DialogDescription>
            बंदोबस्त, व्हीआयपी दौरा किंवा विशेष कार्यक्रमाचा तपशील व कर्मचारी नोंदवा.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field full">
              <label htmlFor="event-title">कार्यक्रमाचे नाव / शीर्षक *</label>
              <input
                id="event-title"
                value={titleMr}
                onChange={(e) => setTitleMr(e.target.value)}
                placeholder="उदा. रामकुंड महाआरती बंदोबस्त"
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="event-date">दिनांक</label>
              <input
                id="event-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="event-start">वेळ</label>
              <input
                id="event-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="event-venue">ठिकाण (Venue)</label>
              <input
                id="event-venue"
                value={venueMr}
                onChange={(e) => setVenueMr(e.target.value)}
                placeholder="उदा. रामकुंड परिसर, पंचवटी"
                disabled={busy}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="event-fallin">उपस्थिती / फॉल-इन सूचना</label>
              <textarea
                id="event-fallin"
                value={fallInMr}
                onChange={(e) => setFallInMr(e.target.value)}
                placeholder="उदा. सर्व अंमलदारांनी १७:०० वा. गणवेशात हजर राहावे"
                disabled={busy}
                rows={2}
                style={{ resize: "vertical", width: "100%" }}
              />
            </div>
          </div>

          {event && (
            <div className="border-t border-line pt-3 mt-2">
              <h4 className="text-sm font-semibold mb-2">नेमलेले कर्मचारी ({event.assignments.length})</h4>
              <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                {event.assignments.map((asgn, i) => (
                  <div key={i} className="flex items-center justify-between py-1 px-2 bg-surface-muted text-xs rounded">
                    <span>
                      <strong>{asgn.person ? personLabel(asgn.person) : "रिक्त"}</strong>
                      {asgn.roleMr && <span className="ml-2 text-muted">({asgn.roleMr})</span>}
                    </span>
                    {asgn.person && (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={assignBusy}
                        onClick={() => removeAssignment(asgn.person!.staffId)}
                      >
                        काढा
                      </Button>
                    )}
                  </div>
                ))}
                {event.assignments.length === 0 && (
                  <p className="text-xs text-muted">अद्याप कर्मचारी नेमलेले नाहीत.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 items-end">
                <div className="form-field flex-1">
                  <label htmlFor="add-event-staff">कर्मचारी जोडा</label>
                  <select
                    id="add-event-staff"
                    value={assignStaffId}
                    onChange={(e) => setAssignStaffId(e.target.value)}
                    disabled={assignBusy || !masters}
                  >
                    <option value="">कर्मचारी निवडा</option>
                    {masters?.staff.map((st) => (
                      <option key={st.staff_id} value={st.staff_id}>
                        {staffOptionLabel(st)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field flex-1">
                  <label htmlFor="add-event-role">भूमिका / कर्तव्य</label>
                  <input
                    id="add-event-role"
                    value={assignRoleMr}
                    onChange={(e) => setAssignRoleMr(e.target.value)}
                    placeholder="उदा. बंदोबस्त अंमलदार"
                    disabled={assignBusy}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={assignBusy || !assignStaffId}
                  onClick={addAssignment}
                >
                  + नेमा
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {event && (
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={removeEvent}>
                  कार्यक्रम हटवा
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                रद्द करा
              </Button>
              <Button type="button" size="sm" variant="primary" disabled={busy} onClick={saveEvent}>
                {busy ? "जतन होत आहे…" : "जतन करा"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// 6. Add Seat Dialog
// -----------------------------------------------------------------------------

export interface AddSeatDialogProps {
  date: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  defaultShift?: Shift;
  defaultColumnNo?: number;
  defaultDutyTitleMr?: string;
  defaultLocationId?: number | null;
}

export function AddSeatDialog({
  date,
  open,
  onOpenChange,
  onSaved,
  defaultShift = "DAY",
  defaultColumnNo = 1,
  defaultDutyTitleMr = "",
  defaultLocationId = null,
}: AddSeatDialogProps) {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [shift, setShift] = useState<Shift>(defaultShift);
  const [columnNo, setColumnNo] = useState(String(defaultColumnNo));
  const [dutyTitleMr, setDutyTitleMr] = useState(defaultDutyTitleMr);
  const [roleMr, setRoleMr] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId ? String(defaultLocationId) : "");
  const [unitCode, setUnitCode] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notesMr, setNotesMr] = useState("");
  const [staffId, setStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setShift(defaultShift);
    setColumnNo(String(defaultColumnNo));
    setDutyTitleMr(defaultDutyTitleMr);
    setRoleMr("");
    setLocationId(defaultLocationId ? String(defaultLocationId) : "");
    setUnitCode("");
    setStartTime("");
    setEndTime("");
    setNotesMr("");
    setStaffId("");
    setError("");

    let active = true;
    apiFetch<MastersResponse>("/api/masters")
      .then((data) => {
        if (active) setMasters(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, defaultShift, defaultColumnNo, defaultDutyTitleMr, defaultLocationId]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/charts/${date}/assignments`, {
        shift,
        columnNo: Number(columnNo) || 1,
        dutyTitleMr: dutyTitleMr.trim() || null,
        roleMr: roleMr.trim() || null,
        locationId: locationId ? Number(locationId) : null,
        unitCode: unitCode.trim() || null,
        startTime: startTime || null,
        endTime: endTime || null,
        notesMr: notesMr.trim() || null,
        staffId: staffId ? Number(staffId) : null,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "जागा तयार करणे अयशस्वी.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>नवीन कर्तव्य जागा जोडा (+ जागा)</DialogTitle>
          <DialogDescription>
            तक्त्यात नवीन जागा तयार करा. जागा सुरुवातीला रिक्त किंवा कर्मचाऱ्यासह असू शकते.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="seat-shift">पाळी (Shift) *</label>
              <select
                id="seat-shift"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
                disabled={busy}
              >
                <option value="DAY">दिवसपाळी (DAY)</option>
                <option value="NIGHT">रात्रपाळी (NIGHT)</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="seat-column">स्तंभ क्रमांक (Column No)</label>
              <input
                id="seat-column"
                type="number"
                value={columnNo}
                onChange={(e) => setColumnNo(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field full">
              <label htmlFor="seat-title">कर्तव्य शीर्षक / पदनाव (Duty Title)</label>
              <input
                id="seat-title"
                value={dutyTitleMr}
                onChange={(e) => setDutyTitleMr(e.target.value)}
                placeholder="उदा. स्टेशन डायरी अंमलदार / कोर्ट ड्युटी"
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="seat-role">भूमिका (Role)</label>
              <input
                id="seat-role"
                value={roleMr}
                onChange={(e) => setRoleMr(e.target.value)}
                placeholder="उदा. अंमलदार, चालक"
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="seat-location">स्थान / चौकी (Location)</label>
              <select
                id="seat-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">ठाणे / सामान्य</option>
                {masters?.locations.map((loc) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    {loc.name_mr}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="seat-start">सुरुवात वेळ</label>
              <input
                id="seat-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="seat-end">समाप्ती वेळ</label>
              <input
                id="seat-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="seat-unit">वाहन / युनिट</label>
              <select
                id="seat-unit"
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">युनिट नाही</option>
                {masters?.units.map((u) => (
                  <option key={u.unit_code} value={u.unit_code}>
                    {u.name_mr} ({u.unit_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="seat-staff">कर्मचारी नेमणूक (ऐच्छिक)</label>
              <select
                id="seat-staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={busy || !masters}
              >
                <option value="">रिक्त ठेवा (नंतर नेमा)</option>
                {masters?.staff.map((st) => (
                  <option key={st.staff_id} value={st.staff_id}>
                    {staffOptionLabel(st)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field full">
              <label htmlFor="seat-notes">नोंद (Notes)</label>
              <input
                id="seat-notes"
                value={notesMr}
                onChange={(e) => setNotesMr(e.target.value)}
                placeholder="अतिरिक्त माहिती"
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              रद्द करा
            </Button>
            <Button type="button" size="sm" variant="primary" disabled={busy} onClick={save}>
              {busy ? "तयार होत आहे…" : "+ जागा जोडा"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
