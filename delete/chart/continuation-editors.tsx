"use client";

/**
 * Purpose: Compact editors for the chart's availability and location-state continuation data.
 * Current role: Keep typed continuation CRUD out of the printed document while making every
 * person, label, window, state, and ordering choice explicit to the clerk.
 * Last meaningful change: 2026-10-18 — initial client continuation editing surface.
 * Constraint: Values are sent verbatim through the existing narrow API; no Marathi text is parsed
 * and no personnel or operational meaning is inferred by the frontend.
 */

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiFetch, apiPatch, apiPost } from "@/lib/api";
import type {
  Availability,
  Location,
  LocationState,
  MastersResponse,
  Person,
  Shift,
  StaffMaster,
} from "@/lib/types";
import { personLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export interface LocationStateTarget {
  location: Location;
  shift: Shift;
  state?: LocationState;
}

type AvailabilityEditorProps = {
  date: string;
  row: Availability | null;
  open: boolean;
  defaultSortOrder: number;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type AvailabilityDraft = {
  staffId: string;
  category: string;
  groupKey: string;
  windowStart: string;
  windowEnd: string;
  timeStart: string;
  timeEnd: string;
  detailMr: string;
  sortOrder: string;
};

function dateInputValue(value: string | null): string {
  return value ?? "";
}

function timeInputValue(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function availabilityDraft(row: Availability | null, defaultSortOrder: number): AvailabilityDraft {
  return {
    staffId: row?.person ? String(row.person.staffId) : "",
    category: row?.category ?? "",
    groupKey: row?.groupKey ?? "",
    windowStart: dateInputValue(row?.windowStart ?? null),
    windowEnd: dateInputValue(row?.windowEnd ?? null),
    timeStart: timeInputValue(row?.timeStart ?? null),
    timeEnd: timeInputValue(row?.timeEnd ?? null),
    detailMr: row?.detailMr ?? "",
    sortOrder: String(row?.sortOrder ?? defaultSortOrder),
  };
}

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

function availabilityError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function AvailabilityEditor({
  date,
  row,
  open,
  defaultSortOrder,
  onOpenChange,
  onSaved,
}: AvailabilityEditorProps) {
  const [draft, setDraft] = useState<AvailabilityDraft>(() => availabilityDraft(row, defaultSortOrder));
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setDraft(availabilityDraft(row, defaultSortOrder));
    setMasters(null);
    setBusy(false);
    setError("");
    setMessage("");
    apiFetch<MastersResponse>("/api/masters")
      .then((value) => {
        if (active) setMasters(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(availabilityError(reason, "Could not load staff choices."));
      });
    return () => {
      active = false;
    };
  }, [defaultSortOrder, open, row]);

  const staffOptions = useMemo(() => {
    const options = [...(masters?.staff ?? [])];
    if (row?.person && !options.some((staff) => staff.staff_id === row.person?.staffId)) {
      options.unshift({
        staff_id: row.person.staffId,
        name_mr: row.person.nameMr,
        name_en: null,
        rank_code: row.person.rankCode,
        buckle_no: row.person.buckleNo ?? null,
        phone: null,
        duty_assignment: null,
        weekly_off: null,
        active: true,
      });
    }
    return options;
  }, [masters, row]);

  const updateDraft = <K extends keyof AvailabilityDraft>(key: K, value: AvailabilityDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
  };

  async function save() {
    const category = draft.category.trim();
    const sortOrder = Number(draft.sortOrder);
    if (!category) {
      setError("Category is required.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setError("Sort order must be a whole number of 0 or greater.");
      return;
    }
    const staffId = draft.staffId === "" ? null : Number(draft.staffId);
    if (staffId !== null && !Number.isInteger(staffId)) {
      setError("Choose an explicit staff member or रिक्त.");
      return;
    }
    const payload = {
      staffId,
      category,
      groupKey: draft.groupKey.trim() || null,
      windowStart: draft.windowStart || null,
      windowEnd: draft.windowEnd || null,
      timeStart: draft.timeStart || null,
      timeEnd: draft.timeEnd || null,
      detailMr: draft.detailMr || null,
      sortOrder,
    };
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (row) {
        await apiPatch(`/api/charts/${date}/availabilities/${row.availabilityId}`, payload);
      } else {
        await apiPost(`/api/charts/${date}/availabilities`, payload);
      }
      setMessage(row ? "Availability row saved." : "Availability row added.");
      onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(availabilityError(reason, "Could not save availability row."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!row || !window.confirm("Delete this availability row?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiDelete(`/api/charts/${date}/availabilities/${row.availabilityId}`);
      setMessage("Availability row deleted.");
      onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(availabilityError(reason, "Could not delete availability row."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>{row ? "Edit availability row" : "Add availability row"}</DialogTitle>
          <DialogDescription>
            Enter the source values explicitly. Date and time fields stay typed fields; detail text is display-only.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          {message && <div className="status-line success" role="status">{message}</div>}
          <div className="form-grid">
            <div className="form-field full">
              <label htmlFor="availability-staff">Staff</label>
              <select
                id="availability-staff"
                value={draft.staffId}
                disabled={busy || !masters}
                onChange={(event) => updateDraft("staffId", event.target.value)}
              >
                <option value="">रिक्त / no staff</option>
                {staffOptions.map((staff) => <option key={staff.staff_id} value={staff.staff_id}>{staffOptionLabel(staff)}</option>)}
              </select>
              {!masters && !error && <span className="form-hint">Loading explicit staff choices…</span>}
            </div>
            <div className="form-field">
              <label htmlFor="availability-category">Category *</label>
              <input id="availability-category" value={draft.category} onChange={(event) => updateDraft("category", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-group">Group</label>
              <input id="availability-group" value={draft.groupKey} onChange={(event) => updateDraft("groupKey", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-window-start">Window start date</label>
              <input id="availability-window-start" type="date" value={draft.windowStart} onChange={(event) => updateDraft("windowStart", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-window-end">Window end date</label>
              <input id="availability-window-end" type="date" value={draft.windowEnd} onChange={(event) => updateDraft("windowEnd", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-time-start">Time start</label>
              <input id="availability-time-start" type="time" step="1" value={draft.timeStart} onChange={(event) => updateDraft("timeStart", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-time-end">Time end</label>
              <input id="availability-time-end" type="time" step="1" value={draft.timeEnd} onChange={(event) => updateDraft("timeEnd", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="availability-sort-order">Sort order *</label>
              <input id="availability-sort-order" type="number" min="0" step="1" value={draft.sortOrder} onChange={(event) => updateDraft("sortOrder", event.target.value)} />
            </div>
            <div className="form-field full">
              <label htmlFor="availability-detail">Detail text</label>
              <textarea id="availability-detail" value={draft.detailMr} onChange={(event) => updateDraft("detailMr", event.target.value)} />
            </div>
          </div>
          <p className="form-hint">No category or detail text is interpreted by the editor. Empty optional values are saved as empty typed fields.</p>
          <div className="form-actions">
            {row && <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>Delete row</Button>}
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setDraft(availabilityDraft(row, defaultSortOrder))}>Reset form</Button>
            <Button type="button" variant="primary" size="sm" disabled={busy || !masters} onClick={() => void save()}>{busy ? "Saving…" : row ? "Save row" : "Add row"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type LocationStateEditorProps = {
  date: string;
  target: LocationStateTarget | null;
  locations: Location[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function shiftLabel(shift: Shift): string {
  return shift === "DAY" ? "दिवसपाळी" : "रात्रपाळी";
}

export function LocationStateEditor({ date, target, locations, open, onOpenChange, onSaved }: LocationStateEditorProps) {
  const [isClosed, setIsClosed] = useState(false);
  const [chargeDestinationLocationId, setChargeDestinationLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const resetForm = () => {
    setIsClosed(target?.state?.isClosed ?? false);
    setChargeDestinationLocationId(target?.state?.chargeTo ? String(target.state.chargeTo.locationId) : "");
    setError("");
    setMessage("");
  };

  useEffect(() => {
    if (open) resetForm();
    // The dialog is intentionally reset only when its target opens/changes. Typing in the form
    // must not be overwritten by a parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const destinationOptions = useMemo(
    () => locations.filter((location) => location.locationId !== target?.location.locationId),
    [locations, target],
  );

  async function save() {
    if (!target) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiPatch(
        `/api/charts/${date}/location-states/${target.location.locationId}/${target.shift}`,
        {
          isClosed,
          chargeDestinationLocationId: chargeDestinationLocationId ? Number(chargeDestinationLocationId) : null,
        },
      );
      setMessage("Location state saved.");
      onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(availabilityError(reason, "Could not save location state."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!target?.state || !window.confirm("Delete this explicit location state?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiDelete(`/api/charts/${date}/location-states/${target.location.locationId}/${target.shift}`);
      setMessage("Location state deleted and reset to unconfigured.");
      onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(availabilityError(reason, "Could not delete location state."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="continuation-dialog no-print">
        <DialogHeader>
          <DialogTitle>Edit location state</DialogTitle>
          <DialogDescription>{target ? `${target.location.nameMr}, ${shiftLabel(target.shift)}` : "Location state"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-5">
          {error && <div className="status-line error" role="alert">{error}</div>}
          {message && <div className="status-line success" role="status">{message}</div>}
          <div className="location-state-form">
            <label className="location-state-toggle">
              <Switch checked={isClosed} disabled={busy || !target} onCheckedChange={setIsClosed} />
              <span><strong>बंद</strong><small>Explicit closed state for this location and shift.</small></span>
            </label>
            <div className="form-field">
              <label htmlFor="location-charge-destination">Charge destination</label>
              <select
                id="location-charge-destination"
                value={chargeDestinationLocationId}
                disabled={busy || !target}
                onChange={(event) => setChargeDestinationLocationId(event.target.value)}
              >
                <option value="">No charge destination</option>
                {destinationOptions.map((location) => <option key={location.locationId} value={location.locationId}>{location.nameMr}</option>)}
              </select>
              <span className="form-hint">Choose only an explicit chart location. The editor does not infer a destination from notes or the closed toggle.</span>
            </div>
          </div>
          <div className="form-actions">
            {target?.state && <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>Delete / reset state</Button>}
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={resetForm}>Reset form</Button>
            <Button type="button" variant="primary" size="sm" disabled={busy || !target} onClick={() => void save()}>{busy ? "Saving…" : "Save state"}</Button>
          </div>
          <p className="form-hint">Delete state removes the explicit row and resets this shift/location to an unconfigured state. It does not change assignments.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
