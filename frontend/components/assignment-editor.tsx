"use client";

/**
 * Purpose: Explicit person selection for the originating chart seat.
 * Current role: Bounded active-staff search and immediately reachable master/create forms.
 * Last meaningful change: 2026-10-18 — localized picker modes and honest partial create/place recovery.
 * Constraint: Selection resets explicit बिमा; staff creation and placement remain separate API requests.
 */
import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiFetch, apiPatch, apiPost } from "@/lib/api";
import type { Assignment, MastersResponse } from "@/lib/types";
import { personLabel, timeLabel } from "@/lib/format";
import { filterStaffChoices, staffChoiceById } from "@/lib/staff-picker";
import { useLocale } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import styles from "./assignment-editor.module.css";

const COPY = {
  en: {
    title: "Assign staff", station: "Station duty", currentSeat: "Current seat", clear: "Clear to रिक्त", bima: "बिमा for this assignment", bimaHint: "This seat only",
    modes: "Staff actions", pick: "Choose existing", edit: "Edit current staff", create: "New staff", seat: "Seat details", close: "Close", choose: "Choose", current: "Current",
    search: "Search active staff", placeholder: "Name, buckle number or rank", rank: "Rank", allRanks: "All ranks", empty: "No active staff match this search.",
    loading: "Loading staff…", retry: "Retry loading", loadError: "Staff records are unavailable.", chooseHint: "Choosing a person places them in this seat and resets बिमा to off. You can set it again explicitly.",
    count: (shown: number, total: number) => `${shown} of ${total} active staff`,
    editTitle: "Edit staff master", editHint: "Updates the current person's master record. This does not change the assignment's explicit बिमा field.",
    createTitle: "Create and place staff", createHint: "Saves a new staff master, then places that person in this seat. These are two separate saves.",
    seatTitle: "Edit seat details", seatHint: "Updates timing, role title, vehicle unit, or notes for this specific seat.",
    dutyTitle: "Duty title", role: "Role", startTime: "Start time", endTime: "End time", unit: "Unit / Vehicle", notes: "Notes",
    name: "Name in Marathi", buckle: "Buckle number", phone: "Phone", selectRank: "Select rank", saveMaster: "Save staff fields", createAndPlace: "Create and place", retryPlacement: "Retry placement", saveSeat: "Save seat details", deleteSeat: "Delete vacant seat", saving: "Saving…",
    required: "Marathi name and rank are required.", nameRequired: "Marathi name is required.", saved: "Assignment saved.", cleared: "Seat cleared to रिक्त.", masterSaved: "Master staff fields saved.", created: "New staff member created and placed in this seat.", seatSaved: "Seat details updated.", seatDeleted: "Vacant seat removed.",
    saveFailed: "Could not save the assignment.", masterFailed: "Could not save staff fields.", createFailed: "Could not confirm staff creation and placement. Check the staff list before creating another record.",
    partial: "The staff record was created, but placement could not be confirmed. Retry placement below; it reuses the saved person.",
    savedPerson: "Staff record saved; placement not confirmed", lockedFields: "These fields show the saved staff record. Retry places this person without creating another record.",
  },
  mr: {
    title: "कर्मचारी नेमणूक", station: "ठाण्यातील कर्तव्य", currentSeat: "सध्याची नेमणूक", clear: "रिक्त करा", bima: "या नेमणुकीसाठी बिमा", bimaHint: "फक्त या जागेसाठी",
    modes: "कर्मचारी पर्याय", pick: "कर्मचारी निवडा", edit: "सध्याची माहिती बदला", create: "नवीन कर्मचारी", seat: "जागा तपशील", close: "बंद करा", choose: "निवडा", current: "सध्याचे",
    search: "सक्रिय कर्मचारी शोधा", placeholder: "नाव, बकल क्रमांक किंवा हुद्दा", rank: "हुद्दा", allRanks: "सर्व हुद्दे", empty: "या शोधानुसार सक्रिय कर्मचारी सापडले नाहीत.",
    loading: "कर्मचारी लोड होत आहेत…", retry: "पुन्हा लोड करा", loadError: "कर्मचारी नोंदी उपलब्ध नाहीत.", chooseHint: "निवडलेला कर्मचारी या जागी नेमला जाईल आणि बिमा बंद होईल. आवश्यक असल्यास बिमा पुन्हा स्पष्टपणे निवडा.",
    count: (shown: number, total: number) => `${total} सक्रिय कर्मचाऱ्यांपैकी ${shown}`,
    editTitle: "कर्मचाऱ्याची मूळ माहिती बदला", editHint: "सध्याच्या कर्मचाऱ्याची मूळ नोंद बदलते. या नेमणुकीचे स्पष्ट बिमा क्षेत्र बदलत नाही.",
    createTitle: "नवीन कर्मचारी तयार करून नेमा", createHint: "प्रथम नवीन कर्मचाऱ्याची मूळ नोंद जतन होते, नंतर या जागी नेमणूक होते. या दोन स्वतंत्र कृती आहेत.",
    seatTitle: "जागेचा तपशील बदला", seatHint: "या जागेची वेळ, पदनाम, वाहन किंवा नोंद अद्यतनित करा.",
    dutyTitle: "कर्तव्य शीर्षक / पदनाम", role: "भूमिका", startTime: "सुरुवात वेळ", endTime: "समाप्ती वेळ", unit: "वाहन / युनिट", notes: "नोंद",
    name: "नाव मराठीत", buckle: "बकल क्रमांक", phone: "फोन", selectRank: "हुद्दा निवडा", saveMaster: "माहिती जतन करा", createAndPlace: "तयार करून नेमा", retryPlacement: "नेमणूक पुन्हा करा", saveSeat: "जागा जतन करा", deleteSeat: "ही जागा हटवा", saving: "जतन होत आहे…",
    required: "मराठी नाव आणि हुद्दा आवश्यक आहेत.", nameRequired: "मराठी नाव आवश्यक आहे.", saved: "नेमणूक जतन झाली.", cleared: "जागा रिक्त केली.", masterSaved: "कर्मचाऱ्याची मूळ माहिती जतन झाली.", created: "नवीन कर्मचारी तयार झाला आणि या जागी नेमला गेला.", seatSaved: "जागा तपशील जतन झाले.", seatDeleted: "रिक्त जागा हटवली गेली.",
    saveFailed: "नेमणूक जतन झाली नाही.", masterFailed: "कर्मचाऱ्याची माहिती जतन झाली नाही.", createFailed: "कर्मचारी तयार करणे आणि नेमणूक झाल्याची खात्री करता आली नाही. आणखी नोंद तयार करण्यापूर्वी कर्मचारी यादी तपासा.",
    partial: "कर्मचाऱ्याची मूळ नोंद तयार झाली; नेमणूक झाल्याची खात्री करता आली नाही. खाली नेमणूक पुन्हा करा; जतन केलेलाच कर्मचारी वापरला जाईल.",
    savedPerson: "कर्मचारी नोंद जतन झाली; नेमणुकीची खात्री झाली नाही", lockedFields: "ही जतन केलेल्या कर्मचाऱ्याची माहिती आहे. पुन्हा नेमणूक केल्यास आणखी नोंद तयार होणार नाही.",
  },
} as const;

type StaffForm = { nameMr: string; rankCode: string; buckleNo: string; phone: string };
const EMPTY_FORM: StaffForm = { nameMr: "", rankCode: "", buckleNo: "", phone: "" };
type SeatForm = { dutyTitleMr: string; roleMr: string; startTime: string; endTime: string; notesMr: string; unitCode: string };
const EMPTY_SEAT_FORM: SeatForm = { dutyTitleMr: "", roleMr: "", startTime: "", endTime: "", notesMr: "", unitCode: "" };

export function AssignmentEditor({ date, assignment, open, onOpenChange, onSaved }: { date: string; assignment: Assignment | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [rankFilter, setRankFilter] = useState("");
  const [mode, setMode] = useState<"pick" | "edit" | "create" | "seat">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createForm, setCreateForm] = useState<StaffForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<StaffForm>(EMPTY_FORM);
  const [seatForm, setSeatForm] = useState<SeatForm>(EMPTY_SEAT_FORM);
  const [createdStaff, setCreatedStaff] = useState<{ staffId: number; nameMr: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setRankFilter(""); setMode("pick"); setError(""); setMessage("");
    setCreateForm(EMPTY_FORM); setCreatedStaff(null);
    setSeatForm({
      dutyTitleMr: assignment?.dutyTitleMr ?? "",
      roleMr: assignment?.roleMr ?? "",
      startTime: assignment?.startTime?.slice(0, 5) ?? "",
      endTime: assignment?.endTime?.slice(0, 5) ?? "",
      notesMr: assignment?.notesMr ?? "",
      unitCode: assignment?.unit?.unitCode ?? "",
    });
  }, [open, assignment]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setMasters(null);
    apiFetch<MastersResponse>("/api/masters").then((data) => {
      if (active) { setMasters(data); setLoading(false); }
    }).catch((reason: Error) => { if (active) { setError(reason.message); setLoading(false); } });
    return () => { active = false; };
  }, [open, loadAttempt]);

  useEffect(() => {
    const current = staffChoiceById(masters?.staff ?? [], assignment?.person?.staffId);
    setEditForm(current ? { nameMr: current.name_mr, rankCode: current.rank_code, buckleNo: current.buckle_no ?? "", phone: current.phone ?? "" }
      : assignment?.person ? { nameMr: assignment.person.nameMr, rankCode: assignment.person.rankCode, buckleNo: assignment.person.buckleNo ?? "", phone: "" } : EMPTY_FORM);
  }, [assignment, masters]);

  const results = useMemo(() => filterStaffChoices(masters?.staff ?? [], query, rankFilter), [masters, query, rankFilter]);
  const activeCount = masters?.staff.filter((staff) => staff.active).length ?? 0;
  if (!assignment) return null;
  const currentAssignment = assignment;
  const failureDetail = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

  async function mutate(staffId: number | null, isBima: boolean) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await apiPatch(`/api/charts/${date}/assignments/${currentAssignment.assignmentId}`, { staffId, isBima });
      setMessage(staffId === null ? copy.cleared : copy.saved);
      onSaved();
    } catch (reason) {
      const detail = failureDetail(reason, copy.saveFailed);
      setError(createdStaff?.staffId === staffId ? `${copy.partial} ${detail}` : detail);
    } finally { setBusy(false); }
  }

  async function createAndPlace() {
    if (busy) return;
    if (createdStaff) { await mutate(createdStaff.staffId, false); return; }
    if (!createForm.nameMr.trim() || !createForm.rankCode) { setError(copy.required); return; }
    setBusy(true); setError(""); setMessage("");
    let savedStaffId: number | null = null;
    try {
      const created = await apiPost<{ staff_id: number }>("/api/masters/staff", {
        name_mr: createForm.nameMr.trim(), rank_code: createForm.rankCode,
        buckle_no: createForm.buckleNo.trim() || null, phone: createForm.phone.trim() || null,
      });
      savedStaffId = created.staff_id;
      setCreatedStaff({ staffId: created.staff_id, nameMr: createForm.nameMr.trim() });
      await apiPatch(`/api/charts/${date}/assignments/${currentAssignment.assignmentId}`, { staffId: created.staff_id, isBima: false });
      setMessage(copy.created);
      onSaved();
    } catch (reason) {
      setError(`${savedStaffId === null ? copy.createFailed : copy.partial} ${failureDetail(reason, copy.saveFailed)}`);
      // Refresh the list for inspection even when transport failed before returning a new staff id.
      apiFetch<MastersResponse>("/api/masters").then(setMasters).catch(() => {});
    } finally { setBusy(false); }
  }

  async function saveMaster() {
    if (busy || !currentAssignment.person) return;
    if (!editForm.nameMr.trim()) { setError(copy.nameRequired); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await apiPatch(`/api/masters/staff/${currentAssignment.person.staffId}`, { name_mr: editForm.nameMr.trim(), buckle_no: editForm.buckleNo.trim() || null, phone: editForm.phone.trim() || null });
      setMessage(copy.masterSaved);
      onSaved();
    } catch (reason) { setError(failureDetail(reason, copy.masterFailed)); } finally { setBusy(false); }
  }

  async function saveSeat() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await apiPatch(`/api/charts/${date}/assignments/${currentAssignment.assignmentId}/metadata`, {
        dutyTitleMr: seatForm.dutyTitleMr.trim() || null,
        roleMr: seatForm.roleMr.trim() || null,
        startTime: seatForm.startTime || null,
        endTime: seatForm.endTime || null,
        notesMr: seatForm.notesMr.trim() || null,
        unitCode: seatForm.unitCode.trim() || null,
      });
      setMessage(copy.seatSaved);
      onSaved();
    } catch (reason) { setError(failureDetail(reason, copy.saveFailed)); } finally { setBusy(false); }
  }

  async function deleteSeat() {
    if (busy || currentAssignment.person) return;
    if (!window.confirm("ही रिक्त जागा कायमची हटवायची आहे का?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await apiDelete(`/api/charts/${date}/assignments/${currentAssignment.assignmentId}`);
      setMessage(copy.seatDeleted);
      onSaved();
      onOpenChange(false);
    } catch (reason) { setError(failureDetail(reason, "जागा हटवणे अयशस्वी.")); } finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className={styles.dialog}>
      <DialogHeader className={styles.header}>
        <DialogTitle><span lang={currentAssignment.dutyTitleMr || currentAssignment.roleMr ? "mr" : locale}>{currentAssignment.dutyTitleMr || currentAssignment.roleMr || copy.title}</span></DialogTitle>
        <DialogDescription className={styles.context}>
          <span lang={currentAssignment.location ? "mr" : locale}>{currentAssignment.location?.nameMr || copy.station}</span>
          <span lang="mr"> · {currentAssignment.shift === "DAY" ? "दिवसपाळी" : "रात्रपाळी"}{timeLabel(currentAssignment) ? ` · ${timeLabel(currentAssignment)}` : ""}</span>
        </DialogDescription>
      </DialogHeader>

      <section className={styles.currentSeat}>
        <div className={styles.currentIdentity}>
          <span className={styles.fieldLabel}>{copy.currentSeat}</span>
          <span className={styles.person} lang="mr">{currentAssignment.person ? personLabel(currentAssignment.person) : <span className="vacant-tag">रिक्त</span>}</span>
          {currentAssignment.isBima && <Badge tone="red">बिमा</Badge>}
        </div>
        <div className={styles.seatActions}>
          <label className={styles.bimaControl}>
            <Switch checked={currentAssignment.isBima} disabled={busy || !currentAssignment.person} onCheckedChange={(checked) => void mutate(currentAssignment.person?.staffId ?? null, checked)} aria-label={copy.bima} />
            <span>{copy.bima}<span className={styles.hint}>{copy.bimaHint}</span></span>
          </label>
          <Button type="button" size="sm" variant="danger" disabled={busy || !currentAssignment.person} onClick={() => void mutate(null, false)}>{copy.clear}</Button>
        </div>
      </section>

      <div className={styles.modeButtons} role="group" aria-label={copy.modes}>
        <button type="button" disabled={busy} aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>{copy.pick}</button>
        <button type="button" disabled={busy || !currentAssignment.person || !masters} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>{copy.edit}</button>
        <button type="button" disabled={busy || !masters} aria-pressed={mode === "create"} onClick={() => setMode("create")}>+ {copy.create}</button>
        <button type="button" disabled={busy} aria-pressed={mode === "seat"} onClick={() => setMode("seat")}>{copy.seat}</button>
      </div>

      <div className={styles.panel}>
        {mode === "pick" && <section className={styles.picker} aria-labelledby="staff-picker-title">
          <div className={styles.pickerHeading}>
            <h3 id="staff-picker-title">{copy.pick}</h3>
            <p className={styles.hint}>{copy.chooseHint}</p>
          </div>
          <div className={styles.searchFields}>
            <div className={styles.formField}><label htmlFor="assignment-staff-search">{copy.search}</label><input id="assignment-staff-search" type="search" autoFocus value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder={copy.placeholder} /></div>
            <div className={styles.rankField}><label htmlFor="assignment-rank-filter">{copy.rank}</label><select id="assignment-rank-filter" value={rankFilter} disabled={busy} onChange={(event) => setRankFilter(event.target.value)}><option value="">{copy.allRanks}</option>{masters?.ranks.filter((rank) => rank.active).map((rank) => <option key={rank.rank_code} value={rank.rank_code}>{rank.rank_code}</option>)}</select></div>
          </div>
          <p className={styles.resultCount} role="status">{loading ? copy.loading : masters ? copy.count(results.length, activeCount) : copy.loadError}</p>
          <ul className={styles.staffList} aria-label={copy.pick} aria-busy={loading}>
            {results.map((staff) => <li key={staff.staff_id}><button type="button" disabled={busy} onClick={() => void mutate(Number(staff.staff_id), false)} className={styles.staffOption}>
              <span className={styles.staffName} lang="mr"><span className={styles.rankCode}>{staff.rank_code}</span>{staff.buckle_no && <span className={styles.buckle}>{staff.buckle_no}</span>}<span>{staff.name_mr}</span></span>
              <span className={styles.chooseAction}>{Number(staff.staff_id) === currentAssignment.person?.staffId ? `${copy.current} · ${copy.choose}` : copy.choose}</span>
            </button></li>)}
            {!loading && masters && !results.length && <li className={styles.empty}>{copy.empty}</li>}
            {!loading && !masters && <li className={styles.empty}><Button type="button" size="sm" onClick={() => { setError(""); setLoadAttempt((attempt) => attempt + 1); }}>{copy.retry}</Button></li>}
          </ul>
        </section>}

        {mode === "edit" && currentAssignment.person && <form id="assignment-edit-master" className={styles.formPanel} onSubmit={(event) => { event.preventDefault(); void saveMaster(); }}>
          <div><h3>{copy.editTitle}</h3><p className={styles.hint}>{copy.editHint}</p></div>
          <div className={styles.formGrid}>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="assignment-name-mr">{copy.name} *</label><input id="assignment-name-mr" lang="mr" autoFocus value={editForm.nameMr} disabled={busy} onChange={(event) => setEditForm((form) => ({ ...form, nameMr: event.target.value }))} /></div>
            <div className={styles.formField}><label htmlFor="assignment-master-rank">{copy.rank}</label><input id="assignment-master-rank" value={editForm.rankCode} readOnly /></div>
            <div className={styles.formField}><label htmlFor="assignment-buckle">{copy.buckle}</label><input id="assignment-buckle" value={editForm.buckleNo} disabled={busy} onChange={(event) => setEditForm((form) => ({ ...form, buckleNo: event.target.value }))} /></div>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="assignment-phone">{copy.phone}</label><input id="assignment-phone" type="tel" value={editForm.phone} disabled={busy} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} /></div>
          </div>
        </form>}

        {mode === "create" && <form id="assignment-create-staff" className={styles.formPanel} onSubmit={(event) => { event.preventDefault(); void createAndPlace(); }}>
          <div><h3>{copy.createTitle}</h3><p className={styles.hint}>{createdStaff ? copy.lockedFields : copy.createHint}</p></div>
          {createdStaff && <p className={styles.savedPerson}>{copy.savedPerson}: <span lang="mr">{createdStaff.nameMr}</span></p>}
          <div className={styles.formGrid}>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="new-name-mr">{copy.name} *</label><input id="new-name-mr" lang="mr" autoFocus value={createForm.nameMr} disabled={busy || Boolean(createdStaff)} onChange={(event) => setCreateForm((form) => ({ ...form, nameMr: event.target.value }))} /></div>
            <div className={styles.formField}><label htmlFor="new-rank">{copy.rank} *</label><select id="new-rank" value={createForm.rankCode} disabled={busy || Boolean(createdStaff)} onChange={(event) => setCreateForm((form) => ({ ...form, rankCode: event.target.value }))}><option value="">{copy.selectRank}</option>{masters?.ranks.filter((rank) => rank.active).map((rank) => <option key={rank.rank_code} value={rank.rank_code}>{locale === "mr" && rank.short_form_mr ? `${rank.rank_code} · ${rank.short_form_mr}` : rank.rank_code}</option>)}</select></div>
            <div className={styles.formField}><label htmlFor="new-buckle">{copy.buckle}</label><input id="new-buckle" value={createForm.buckleNo} disabled={busy || Boolean(createdStaff)} onChange={(event) => setCreateForm((form) => ({ ...form, buckleNo: event.target.value }))} /></div>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="new-phone">{copy.phone}</label><input id="new-phone" type="tel" value={createForm.phone} disabled={busy || Boolean(createdStaff)} onChange={(event) => setCreateForm((form) => ({ ...form, phone: event.target.value }))} /></div>
          </div>
        </form>}

        {mode === "seat" && <form id="assignment-edit-seat" className={styles.formPanel} onSubmit={(event) => { event.preventDefault(); void saveSeat(); }}>
          <div><h3>{copy.seatTitle}</h3><p className={styles.hint}>{copy.seatHint}</p></div>
          <div className={styles.formGrid}>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="seat-duty-title">{copy.dutyTitle}</label><input id="seat-duty-title" lang="mr" value={seatForm.dutyTitleMr} disabled={busy} onChange={(event) => setSeatForm((form) => ({ ...form, dutyTitleMr: event.target.value }))} /></div>
            <div className={styles.formField}><label htmlFor="seat-role">{copy.role}</label><input id="seat-role" lang="mr" value={seatForm.roleMr} disabled={busy} onChange={(event) => setSeatForm((form) => ({ ...form, roleMr: event.target.value }))} /></div>
            <div className={styles.formField}><label htmlFor="seat-unit">{copy.unit}</label><select id="seat-unit" value={seatForm.unitCode} disabled={busy || !masters} onChange={(event) => setSeatForm((form) => ({ ...form, unitCode: event.target.value }))}><option value="">निवड नाही / none</option>{masters?.units.map((u) => <option key={u.unit_code} value={u.unit_code}>{u.name_mr} ({u.unit_code})</option>)}</select></div>
            <div className={styles.formField}><label htmlFor="seat-start-time">{copy.startTime}</label><input id="seat-start-time" type="time" value={seatForm.startTime} disabled={busy} onChange={(event) => setSeatForm((form) => ({ ...form, startTime: event.target.value }))} /></div>
            <div className={styles.formField}><label htmlFor="seat-end-time">{copy.endTime}</label><input id="seat-end-time" type="time" value={seatForm.endTime} disabled={busy} onChange={(event) => setSeatForm((form) => ({ ...form, endTime: event.target.value }))} /></div>
            <div className={`${styles.formField} ${styles.fullField}`}><label htmlFor="seat-notes">{copy.notes}</label><input id="seat-notes" lang="mr" value={seatForm.notesMr} disabled={busy} onChange={(event) => setSeatForm((form) => ({ ...form, notesMr: event.target.value }))} /></div>
          </div>
          {!currentAssignment.person && <div className="pt-2"><Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void deleteSeat()}>{copy.deleteSeat}</Button></div>}
        </form>}
      </div>

      {(busy || error || message) && <div className={styles.feedback} role={error && !busy ? "alert" : "status"} data-error={Boolean(error && !busy)}>{busy ? copy.saving : error || message}</div>}
      <div className={styles.footer}>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{copy.close}</Button>
        {mode === "edit" && <Button type="submit" form="assignment-edit-master" size="sm" variant="primary" disabled={busy || !masters}>{busy ? copy.saving : copy.saveMaster}</Button>}
        {mode === "create" && <Button type="submit" form="assignment-create-staff" size="sm" variant="primary" disabled={busy || !masters}>{busy ? copy.saving : createdStaff ? copy.retryPlacement : copy.createAndPlace}</Button>}
        {mode === "seat" && <Button type="submit" form="assignment-edit-seat" size="sm" variant="primary" disabled={busy}>{busy ? copy.saving : copy.saveSeat}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
