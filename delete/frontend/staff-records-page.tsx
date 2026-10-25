"use client";

/**
 * Purpose: Local staff master management surface.
 * Current role: Staff profile CRUD, lifecycle actions, and guarded hard-delete feedback.
 * Last meaningful change: 2026-10-18 — protected rank tokens and contextual deactivation explanation.
 * Constraint: English-name compatibility stays in the API contract but is not a staff form field.
 */
import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiFetch, apiPatch, apiPost } from "@/lib/api";
import type { MastersResponse, StaffMaster } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ComingSoon } from "@/components/coming-soon";
import { ManagementTable, type ManagementTableColumn } from "@/components/management-table";

type StaffDraft = {
  name_mr: string;
  rank_code: string;
  buckle_no: string;
  phone: string;
  duty_assignment: string;
  weekly_off: string;
  active: boolean;
};

type StaffStatusFilter = "all" | "active" | "inactive";

const emptyDraft: StaffDraft = {
  name_mr: "",
  rank_code: "",
  buckle_no: "",
  phone: "",
  duty_assignment: "",
  weekly_off: "",
  active: true,
};

function draftFrom(staff: StaffMaster): StaffDraft {
  return {
    name_mr: staff.name_mr,
    rank_code: staff.rank_code,
    buckle_no: staff.buckle_no ?? "",
    phone: staff.phone ?? "",
    duty_assignment: staff.duty_assignment ?? "",
    weekly_off: staff.weekly_off ?? "",
    active: staff.active,
  };
}

export default function StaffPage() {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>("all");
  const [rankFilter, setRankFilter] = useState("all");
  const [selected, setSelected] = useState<StaffMaster | null>(null);
  const [draft, setDraft] = useState<StaffDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      setMasters(await apiFetch<MastersResponse>("/api/masters"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load staff records");
    }
  };

  useEffect(() => { void load(); }, []);

  const staff = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (masters?.staff ?? []).filter((item) => [
      item.name_mr,
      item.rank_code,
      masters?.ranks.find((rank) => rank.rank_code === item.rank_code)?.name_mr,
      masters?.ranks.find((rank) => rank.rank_code === item.rank_code)?.short_form_mr,
      item.buckle_no,
      item.phone,
      item.duty_assignment,
      item.weekly_off,
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized)
      && (statusFilter === "all" || (statusFilter === "active" ? item.active : !item.active))
      && (rankFilter === "all" || item.rank_code === rankFilter));
  }, [masters, query, rankFilter, statusFilter]);

  const openCreate = () => {
    setSelected(null);
    setCreating(true);
    setDraft({ ...emptyDraft, rank_code: masters?.ranks.find((rank) => rank.active)?.rank_code ?? "" });
    setMessage("");
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (person: StaffMaster) => {
    setSelected(person);
    setCreating(false);
    setDraft(draftFrom(person));
    setMessage("");
    setError("");
    setDialogOpen(true);
  };

  const closeEditor = () => {
    setDialogOpen(false);
    setSelected(null);
    setCreating(false);
    setDraft({ ...emptyDraft });
  };

  const updateDraft = (field: keyof StaffDraft, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    if (!draft.name_mr.trim() || !draft.rank_code) {
      setError("Marathi name and rank are required.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const payload = {
      name_mr: draft.name_mr.trim(),
      rank_code: draft.rank_code,
      buckle_no: draft.buckle_no.trim() || null,
      phone: draft.phone.trim() || null,
      duty_assignment: draft.duty_assignment.trim() || null,
      weekly_off: draft.weekly_off.trim() || null,
    };
    try {
      if (creating) {
        await apiPost("/api/masters/staff", payload);
      } else if (selected) {
        await apiPatch(`/api/masters/staff/${selected.staff_id}`, { ...payload, active: draft.active });
      }
      await load();
      setMessage(creating ? "Staff member created." : "Staff member updated.");
      closeEditor();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save staff member");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (person: StaffMaster) => {
    if (!window.confirm(`${person.active ? "Deactivate" : "Reactivate"} ${person.name_mr}? History is preserved.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiPatch(`/api/masters/staff/${person.staff_id}`, { active: !person.active });
      setMessage(person.active ? "Staff member deactivated." : "Staff member reactivated.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update staff status");
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (person: StaffMaster) => {
    if (!window.confirm(`Permanently delete ${person.name_mr}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiDelete(`/api/masters/staff/${person.staff_id}`);
      setMessage("Staff member deleted.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete staff member");
    } finally {
      setBusy(false);
    }
  };

  const staffColumns: ManagementTableColumn<StaffMaster>[] = [
    { id: "name", label: "Marathi name", width: 150, minWidth: 150, maxWidth: 340, cellClassName: "cell-pre font-medium", render: (person) => person.name_mr },
    { id: "rank", label: "Rank", width: 112, minWidth: 108, maxWidth: 180, cellClassName: "management-table-code", render: (person) => person.rank_code },
    { id: "buckle", label: "Buckle", width: 76, minWidth: 76, maxWidth: 150, render: (person) => person.buckle_no || "" },
    { id: "phone", label: "Phone", width: 100, minWidth: 100, maxWidth: 190, render: (person) => person.phone || "" },
    { id: "duty", label: "Duty / assignment", width: 150, minWidth: 150, maxWidth: 360, cellClassName: "cell-pre", render: (person) => person.duty_assignment || "" },
    { id: "weekly-off", label: "Weekly off", width: 105, minWidth: 105, maxWidth: 240, cellClassName: "cell-pre", render: (person) => person.weekly_off || "" },
    { id: "status", label: "Status", width: 96, minWidth: 96, maxWidth: 160, render: (person) => <Badge tone={person.active ? "green" : "slate"}>{person.active ? "ACTIVE" : "INACTIVE"}</Badge> },
    {
      id: "actions",
      label: "Actions",
      width: 220,
      minWidth: 220,
      maxWidth: 360,
      render: (person) => <div className="flex flex-wrap gap-1">
        <button type="button" className="row-action" disabled={busy} onClick={() => openEdit(person)}>Edit</button>
        <button type="button" className="row-action" title={person.active ? "Deactivate while preserving chart history." : undefined} disabled={busy} onClick={() => void toggleActive(person)}>{person.active ? "Deactivate" : "Re-activate"}</button>
        <button type="button" className="row-action border-red-200 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void removeStaff(person)}>Delete</button>
      </div>,
    },
  ];

  if (!masters && error) {
    return <div className="page-shell"><ComingSoon title="Fastify service unavailable" detail={`Start the root service with npm run dev. ${error}`} /></div>;
  }

  return (
    <div className="page-shell">
      <div className="page-heading">
        <h1>Manage Staff</h1>
        <Button variant="primary" size="sm" onClick={openCreate}>+ Add staff</Button>
      </div>

      {message && <p className="status-line success mb-3">{message}</p>}
      {error && <p className="status-line error mb-3">{error}</p>}

      {masters && <ManagementTable
        storageKey="panchavati-management-staff"
        ariaLabel="Staff records"
        columns={staffColumns}
        rows={staff}
        rowKey={(person) => person.staff_id}
        rowClassName={(person) => person.active ? undefined : "opacity-60"}
        emptyMessage="No staff match these filters."
        countLabel={`${staff.length} of ${masters.staff.length} staff`}
        toolbar={<>
          <div className="form-field staff-search-field">
            <label htmlFor="staff-search">Search staff</label>
            <input id="staff-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, rank, buckle, phone, duty or weekly off" />
          </div>
          <div className="form-field staff-filter-field">
            <label htmlFor="staff-status-filter">Status</label>
            <select id="staff-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StaffStatusFilter)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="form-field staff-filter-field">
            <label htmlFor="staff-rank-filter">Rank</label>
            <select id="staff-rank-filter" value={rankFilter} onChange={(event) => setRankFilter(event.target.value)}>
              <option value="all">All ranks</option>
              {masters.ranks.map((rank) => <option key={rank.rank_code} value={rank.rank_code}>{rank.rank_code} {rank.short_form_mr || rank.name_mr}</option>)}
            </select>
          </div>
        </>}
      />}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeEditor(); else setDialogOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creating ? "Add staff member" : "Edit staff member"}</DialogTitle>
            <DialogDescription>Staff profile fields from the local station records.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 p-5">
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="staff-name-mr">नाव मराठीत *</label>
                <input id="staff-name-mr" value={draft.name_mr} onChange={(event) => updateDraft("name_mr", event.target.value)} autoFocus />
              </div>
              <div className="form-field">
                <label htmlFor="staff-rank">Rank *</label>
                <select id="staff-rank" value={draft.rank_code} onChange={(event) => updateDraft("rank_code", event.target.value)}>
                  <option value="">Select rank</option>
                  {masters?.ranks.filter((rank) => rank.active || rank.rank_code === draft.rank_code).map((rank) => <option key={rank.rank_code} value={rank.rank_code}>{rank.rank_code} {rank.short_form_mr || rank.name_mr}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="staff-buckle">बकल क्रमांक</label>
                <input id="staff-buckle" value={draft.buckle_no} onChange={(event) => updateDraft("buckle_no", event.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="staff-phone">Phone</label>
                <input id="staff-phone" inputMode="tel" value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="staff-duty">Duty / assignment</label>
                <input id="staff-duty" value={draft.duty_assignment} onChange={(event) => updateDraft("duty_assignment", event.target.value)} placeholder="Documented standing duty" />
              </div>
              <div className="form-field">
                <label htmlFor="staff-weekly-off">Weekly off</label>
                <input id="staff-weekly-off" value={draft.weekly_off} onChange={(event) => updateDraft("weekly_off", event.target.value)} placeholder="e.g. रविवार" />
              </div>
            </div>
            {!creating && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={draft.active} onChange={(event) => updateDraft("active", event.target.checked)} /> Active staff member</label>}
            <div className="form-actions">
              <Button variant="secondary" size="sm" disabled={busy} onClick={closeEditor}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save staff"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
