"use client";

/**
 * Purpose: Station master administration page.
 * Current role: Tabbed CRUD for ranks, duties, locations, and units with WIP event/equipment state.
 * Last meaningful change: 2026-10-18 — rank codes remain intact in the shared numbered table.
 * Constraint: All mutations go through the local Fastify API; no remote data source is used.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiFetch, apiPatch, apiPost } from "@/lib/api";
import type { DutyMaster, LocationMaster, MastersResponse, RankMaster, UnitMaster } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManagementTable, type ManagementTableColumn } from "@/components/management-table";

type Tab = "ranks" | "duties" | "locations" | "units" | "events";
type CrudTab = Exclude<Tab, "events">;
type MasterRow = RankMaster | DutyMaster | LocationMaster | UnitMaster;
type FormValue = string | boolean;
type FormState = Record<string, FormValue>;
type EditorState = { tab: CrudTab; mode: "create" | "edit"; row?: MasterRow };

const tabs: Array<{ id: Tab; label: string; wip?: boolean }> = [
  { id: "ranks", label: "Ranks" },
  { id: "duties", label: "Duties" },
  { id: "locations", label: "Locations / Chowkis" },
  { id: "units", label: "Units / Mobiles" },
  { id: "events", label: "Events / equipment", wip: true },
];

const resourceLabels: Record<CrudTab, string> = {
  ranks: "rank",
  duties: "duty",
  locations: "location",
  units: "unit",
};

const resourcePaths: Record<CrudTab, string> = {
  ranks: "ranks",
  duties: "duties",
  locations: "locations",
  units: "units",
};

function initialForm(tab: CrudTab, row?: MasterRow): FormState {
  if (tab === "ranks") {
    const item = row as RankMaster | undefined;
    return {
      rank_code: item?.rank_code ?? "",
      name_mr: item?.name_mr ?? "",
      short_form_mr: item?.short_form_mr ?? "",
      cadre: item?.cadre ?? "OFFICER",
      display_order: String(item?.display_order ?? 0),
      active: item?.active ?? true,
    };
  }
  if (tab === "duties") {
    const item = row as DutyMaster | undefined;
    return {
      duty_code: item?.duty_code ?? "",
      title_mr: item?.title_mr ?? "",
      section_code: item?.section_code ?? "",
      default_shift: item?.default_shift ?? "",
      location_id: item?.location_id == null ? "" : String(item.location_id),
      display_order: String(item?.display_order ?? 0),
      active: item?.active ?? true,
    };
  }
  if (tab === "locations") {
    const item = row as LocationMaster | undefined;
    return {
      location_code: item?.location_code ?? "",
      name_mr: item?.name_mr ?? "",
      kind: item?.kind ?? "CHOWKI",
      display_order: String(item?.display_order ?? 0),
      active: item?.active ?? true,
    };
  }
  const item = row as UnitMaster | undefined;
  return {
    unit_code: item?.unit_code ?? "",
    name_mr: item?.name_mr ?? "",
    unit_type: item?.unit_type ?? "PATROL_MOBILE",
    display_order: String(item?.display_order ?? 0),
    active: item?.active ?? true,
  };
}

function text(form: FormState, field: string): string {
  const value = form[field];
  return typeof value === "string" ? value : "";
}

function active(form: FormState): boolean {
  return form.active === true;
}

export default function MasterDataPage() {
  const [masters, setMasters] = useState<MastersResponse | null>(null);
  const [tab, setTab] = useState<Tab>("ranks");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      setMasters(await apiFetch<MastersResponse>("/api/masters"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load station masters");
    }
  };

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (requested && tabs.some((item) => item.id === requested)) setTab(requested);
    void load();
  }, []);

  const normalized = query.trim().toLocaleLowerCase();
  const matches = (values: Array<string | number | boolean | null | undefined>) => values.join(" ").toLocaleLowerCase().includes(normalized);
  const filteredRanks = useMemo(() => (masters?.ranks ?? []).filter((row) => matches([row.rank_code, row.name_mr, row.short_form_mr, row.cadre, row.active])), [masters, normalized]);
  const filteredDuties = useMemo(() => (masters?.duties ?? []).filter((row) => matches([row.duty_code, row.title_mr, row.section_code, row.default_shift, row.active])), [masters, normalized]);
  const filteredLocations = useMemo(() => (masters?.locations ?? []).filter((row) => matches([row.location_code, row.name_mr, row.kind, row.active])), [masters, normalized]);
  const filteredUnits = useMemo(() => (masters?.units ?? []).filter((row) => matches([row.unit_code, row.name_mr, row.unit_type, row.active])), [masters, normalized]);

  const openCreate = (nextTab: CrudTab) => {
    setTab(nextTab);
    setEditor({ tab: nextTab, mode: "create" });
    setForm(initialForm(nextTab));
    setError("");
    setMessage("");
  };

  const openEdit = (nextTab: CrudTab, row: MasterRow) => {
    setEditor({ tab: nextTab, mode: "edit", row });
    setForm(initialForm(nextTab, row));
    setError("");
    setMessage("");
  };

  const updateForm = (field: string, value: FormValue) => setForm((current) => ({ ...current, [field]: value }));

  const save = async () => {
    if (!editor) return;
    setBusy(true);
    setError("");
    setMessage("");
    const payload: Record<string, unknown> = { active: active(form) };
    if (editor.tab === "ranks") {
      payload.rank_code = text(form, "rank_code").trim();
      payload.name_mr = text(form, "name_mr").trim();
      payload.short_form_mr = text(form, "short_form_mr").trim() || null;
      payload.cadre = text(form, "cadre");
      payload.display_order = Number(text(form, "display_order") || 0);
    } else if (editor.tab === "duties") {
      payload.duty_code = text(form, "duty_code").trim();
      payload.title_mr = text(form, "title_mr").trim();
      payload.section_code = text(form, "section_code").trim() || null;
      payload.default_shift = text(form, "default_shift") || null;
      payload.location_id = text(form, "location_id") ? Number(text(form, "location_id")) : null;
      payload.display_order = Number(text(form, "display_order") || 0);
    } else if (editor.tab === "locations") {
      payload.location_code = text(form, "location_code").trim();
      payload.name_mr = text(form, "name_mr").trim();
      payload.kind = text(form, "kind");
      payload.display_order = Number(text(form, "display_order") || 0);
    } else {
      payload.unit_code = text(form, "unit_code").trim();
      payload.name_mr = text(form, "name_mr").trim();
      payload.unit_type = text(form, "unit_type");
      payload.display_order = Number(text(form, "display_order") || 0);
    }

    try {
      const path = `/api/masters/${resourcePaths[editor.tab]}`;
      if (editor.mode === "create") {
        await apiPost(path, payload);
      } else {
        const row = editor.row as RankMaster | DutyMaster | LocationMaster | UnitMaster;
        const identifier = editor.tab === "ranks"
          ? (row as RankMaster).rank_code
          : editor.tab === "duties"
            ? String((row as DutyMaster).duty_id)
            : editor.tab === "locations"
              ? String((row as LocationMaster).location_id)
              : (row as UnitMaster).unit_code;
        const patchPayload = { ...payload };
        delete patchPayload.rank_code;
        delete patchPayload.duty_code;
        delete patchPayload.location_code;
        delete patchPayload.unit_code;
        await apiPatch(`${path}/${encodeURIComponent(identifier)}`, patchPayload);
      }
      await load();
      setEditor(null);
      setMessage(`${resourceLabels[editor.tab]} ${editor.mode === "create" ? "created" : "updated"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not save ${resourceLabels[editor.tab]}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (nextTab: CrudTab, row: MasterRow) => {
    const isActive = row.active;
    const label = nextTab === "ranks" ? (row as RankMaster).rank_code : nextTab === "duties" ? (row as DutyMaster).title_mr : nextTab === "locations" ? (row as LocationMaster).name_mr : (row as UnitMaster).name_mr;
    if (!window.confirm(`${isActive ? "Deactivate" : "Re-activate"} ${label}?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const identifier = nextTab === "ranks" ? (row as RankMaster).rank_code : nextTab === "duties" ? String((row as DutyMaster).duty_id) : nextTab === "locations" ? String((row as LocationMaster).location_id) : (row as UnitMaster).unit_code;
      await apiPatch(`/api/masters/${resourcePaths[nextTab]}/${encodeURIComponent(identifier)}`, { active: !isActive });
      await load();
      setMessage(`${resourceLabels[nextTab]} ${isActive ? "deactivated" : "re-activated"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not update ${resourceLabels[nextTab]} status`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (nextTab: CrudTab, row: MasterRow) => {
    const label = nextTab === "ranks" ? (row as RankMaster).rank_code : nextTab === "duties" ? (row as DutyMaster).title_mr : nextTab === "locations" ? (row as LocationMaster).name_mr : (row as UnitMaster).name_mr;
    if (!window.confirm(`Permanently delete ${label}?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const identifier = nextTab === "ranks" ? (row as RankMaster).rank_code : nextTab === "duties" ? String((row as DutyMaster).duty_id) : nextTab === "locations" ? String((row as LocationMaster).location_id) : (row as UnitMaster).unit_code;
      await apiDelete(`/api/masters/${resourcePaths[nextTab]}/${encodeURIComponent(identifier)}`);
      await load();
      setMessage(`${resourceLabels[nextTab]} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not delete ${resourceLabels[nextTab]}`);
    } finally {
      setBusy(false);
    }
  };

  const actions = (nextTab: CrudTab, row: MasterRow) => (
    <div className="flex flex-wrap gap-1">
      <button type="button" className="row-action" disabled={busy} onClick={() => openEdit(nextTab, row)}>Edit</button>
      <button type="button" className="row-action" disabled={busy} onClick={() => void toggleActive(nextTab, row)}>{row.active ? "Deactivate" : "Re-activate"}</button>
      <button type="button" className="row-action border-red-200 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void remove(nextTab, row)}>Delete</button>
    </div>
  );

  if (!masters && error) return <div className="page-shell"><section className="surface p-5"><p className="status-line error">{error}</p></section></div>;

  return (
    <div className="page-shell">
      <div className="page-heading">
        <h1>Master Data</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled>Import (WIP)</Button>
          <Link href="/staff" className={buttonClassName({ variant: "primary", size: "sm" })}>Manage staff</Link>
        </div>
      </div>

      {message && <p className="status-line success mb-3">{message}</p>}
      {error && <p className="status-line error mb-3">{error}</p>}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-300" role="tablist" aria-label="Master data categories">
        {tabs.map((item) => (
          <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setQuery(""); }} className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${tab === item.id ? "border-navy font-semibold text-navy" : "border-transparent text-slate-500 hover:text-navy"}`}>
            {item.label}{item.wip && <Badge tone="amber">WIP</Badge>}
          </button>
        ))}
      </div>

      {masters && tab === "ranks" && <ManagementTable
        storageKey="panchavati-management-ranks"
        ariaLabel="Ranks master"
        columns={[
          { id: "code", label: "Code", width: 112, minWidth: 108, maxWidth: 180, cellClassName: "management-table-code", render: (row: RankMaster) => row.rank_code },
          { id: "short-form", label: "Short form", width: 95, minWidth: 95, maxWidth: 220, cellClassName: "cell-pre", render: (row: RankMaster) => row.short_form_mr || "" },
          { id: "name", label: "Name", width: 160, minWidth: 160, maxWidth: 380, cellClassName: "cell-pre", render: (row: RankMaster) => row.name_mr },
          { id: "cadre", label: "Cadre", width: 110, minWidth: 110, maxWidth: 220, render: (row: RankMaster) => row.cadre },
          { id: "status", label: "Status", width: 96, minWidth: 96, maxWidth: 160, render: (row: RankMaster) => <Badge tone={row.active ? "green" : "slate"}>{row.active ? "ACTIVE" : "INACTIVE"}</Badge> },
          { id: "actions", label: "Actions", width: 220, minWidth: 220, maxWidth: 360, render: (row: RankMaster) => actions("ranks", row) },
        ] satisfies ManagementTableColumn<RankMaster>[]}
        rows={filteredRanks}
        rowKey={(row) => row.rank_code}
        rowClassName={(row) => row.active ? undefined : "opacity-60"}
        emptyMessage="No ranks match this search."
        countLabel={`${filteredRanks.length} of ${masters.ranks.length} ranks`}
        toolbar={<div className="form-field"><label htmlFor="ranks-search">Search ranks</label><input id="ranks-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code or Marathi title" /></div>}
        actions={<Button variant="primary" size="sm" onClick={() => openCreate("ranks")}>+ Add rank</Button>}
      />}

      {masters && tab === "duties" && <ManagementTable
        storageKey="panchavati-management-duties"
        ariaLabel="Duties master"
        columns={[
          { id: "code", label: "Code", width: 95, minWidth: 95, maxWidth: 220, render: (row: DutyMaster) => row.duty_code },
          { id: "title", label: "Title", width: 170, minWidth: 170, maxWidth: 430, cellClassName: "cell-pre", render: (row: DutyMaster) => row.title_mr },
          { id: "section", label: "Section", width: 95, minWidth: 95, maxWidth: 220, render: (row: DutyMaster) => row.section_code || "" },
          { id: "shift", label: "Shift", width: 90, minWidth: 90, maxWidth: 170, render: (row: DutyMaster) => row.default_shift || "" },
          { id: "location", label: "Location", width: 135, minWidth: 135, maxWidth: 320, cellClassName: "cell-pre", render: (row: DutyMaster) => masters.locations.find((location) => location.location_id === row.location_id)?.name_mr || "" },
          { id: "status", label: "Status", width: 96, minWidth: 96, maxWidth: 160, render: (row: DutyMaster) => <Badge tone={row.active ? "green" : "slate"}>{row.active ? "ACTIVE" : "INACTIVE"}</Badge> },
          { id: "actions", label: "Actions", width: 220, minWidth: 220, maxWidth: 360, render: (row: DutyMaster) => actions("duties", row) },
        ] satisfies ManagementTableColumn<DutyMaster>[]}
        rows={filteredDuties}
        rowKey={(row) => row.duty_id}
        rowClassName={(row) => row.active ? undefined : "opacity-60"}
        emptyMessage="No duties match this search."
        countLabel={`${filteredDuties.length} of ${masters.duties.length} duties`}
        toolbar={<div className="form-field"><label htmlFor="duties-search">Search duties</label><input id="duties-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, title or section" /></div>}
        actions={<Button variant="primary" size="sm" onClick={() => openCreate("duties")}>+ Add duty</Button>}
      />}

      {masters && tab === "locations" && <ManagementTable
        storageKey="panchavati-management-locations"
        ariaLabel="Locations and chowkis master"
        columns={[
          { id: "code", label: "Code", width: 105, minWidth: 105, maxWidth: 260, render: (row: LocationMaster) => row.location_code },
          { id: "name", label: "Name", width: 170, minWidth: 170, maxWidth: 420, cellClassName: "cell-pre", render: (row: LocationMaster) => row.name_mr },
          { id: "kind", label: "Kind", width: 115, minWidth: 115, maxWidth: 240, render: (row: LocationMaster) => row.kind },
          { id: "order", label: "Order", width: 70, minWidth: 70, maxWidth: 140, render: (row: LocationMaster) => row.display_order },
          { id: "status", label: "Status", width: 96, minWidth: 96, maxWidth: 160, render: (row: LocationMaster) => <Badge tone={row.active ? "green" : "slate"}>{row.active ? "ACTIVE" : "INACTIVE"}</Badge> },
          { id: "actions", label: "Actions", width: 220, minWidth: 220, maxWidth: 360, render: (row: LocationMaster) => actions("locations", row) },
        ] satisfies ManagementTableColumn<LocationMaster>[]}
        rows={filteredLocations}
        rowKey={(row) => row.location_id}
        rowClassName={(row) => row.active ? undefined : "opacity-60"}
        emptyMessage="No locations match this search."
        countLabel={`${filteredLocations.length} of ${masters.locations.length} locations`}
        toolbar={<div className="form-field"><label htmlFor="locations-search">Search locations</label><input id="locations-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, name or kind" /></div>}
        actions={<Button variant="primary" size="sm" onClick={() => openCreate("locations")}>+ Add location</Button>}
      />}

      {masters && tab === "units" && <ManagementTable
        storageKey="panchavati-management-units"
        ariaLabel="Units and mobiles master"
        columns={[
          { id: "code", label: "Code", width: 105, minWidth: 105, maxWidth: 260, render: (row: UnitMaster) => row.unit_code },
          { id: "name", label: "Name", width: 170, minWidth: 170, maxWidth: 420, cellClassName: "cell-pre", render: (row: UnitMaster) => row.name_mr },
          { id: "type", label: "Type", width: 130, minWidth: 130, maxWidth: 320, render: (row: UnitMaster) => row.unit_type },
          { id: "order", label: "Order", width: 70, minWidth: 70, maxWidth: 140, render: (row: UnitMaster) => row.display_order },
          { id: "status", label: "Status", width: 96, minWidth: 96, maxWidth: 160, render: (row: UnitMaster) => <Badge tone={row.active ? "green" : "slate"}>{row.active ? "ACTIVE" : "INACTIVE"}</Badge> },
          { id: "actions", label: "Actions", width: 220, minWidth: 220, maxWidth: 360, render: (row: UnitMaster) => actions("units", row) },
        ] satisfies ManagementTableColumn<UnitMaster>[]}
        rows={filteredUnits}
        rowKey={(row) => row.unit_code}
        rowClassName={(row) => row.active ? undefined : "opacity-60"}
        emptyMessage="No units match this search."
        countLabel={`${filteredUnits.length} of ${masters.units.length} units`}
        toolbar={<div className="form-field"><label htmlFor="units-search">Search units</label><input id="units-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, name or type" /></div>}
        actions={<Button variant="primary" size="sm" onClick={() => openCreate("units")}>+ Add unit</Button>}
      />}

      {tab === "events" && <section className="surface p-5"><div className="flex items-center gap-2"><h2 className="m-0 text-base font-semibold text-navy">Events / equipment</h2><Badge tone="amber">Coming Soon</Badge></div><div className="mt-2 text-sm text-slate-500">No event or equipment master tables exist yet.</div></section>}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent>
          {editor && <>
            <DialogHeader><DialogTitle>{editor.mode === "create" ? `Add ${resourceLabels[editor.tab]}` : `Edit ${resourceLabels[editor.tab]}`}</DialogTitle><DialogDescription>Changes are saved to the local station master.</DialogDescription></DialogHeader>
            <div className="grid gap-4 p-5">
              {editor.tab === "ranks" && <div className="form-grid">
                <div className="form-field"><label htmlFor="master-code">Rank code *</label><input id="master-code" value={text(form, "rank_code")} disabled={editor.mode === "edit"} onChange={(event) => updateForm("rank_code", event.target.value.toUpperCase())} /></div>
                <div className="form-field"><label htmlFor="master-name">Name *</label><input id="master-name" value={text(form, "name_mr")} onChange={(event) => updateForm("name_mr", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-short">Short form</label><input id="master-short" value={text(form, "short_form_mr")} onChange={(event) => updateForm("short_form_mr", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-cadre">Cadre *</label><select id="master-cadre" value={text(form, "cadre")} onChange={(event) => updateForm("cadre", event.target.value)}><option value="OFFICER">OFFICER</option><option value="CONSTABULARY">CONSTABULARY</option><option value="HOME_GUARD">HOME_GUARD</option></select></div>
                <div className="form-field"><label htmlFor="master-order">Display order</label><input id="master-order" type="number" min="0" value={text(form, "display_order")} onChange={(event) => updateForm("display_order", event.target.value)} /></div>
              </div>}
              {editor.tab === "duties" && <div className="form-grid">
                <div className="form-field"><label htmlFor="master-code">Duty code *</label><input id="master-code" value={text(form, "duty_code")} disabled={editor.mode === "edit"} onChange={(event) => updateForm("duty_code", event.target.value.toUpperCase())} /></div>
                <div className="form-field"><label htmlFor="master-name">Title *</label><input id="master-name" value={text(form, "title_mr")} onChange={(event) => updateForm("title_mr", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-section">Section</label><input id="master-section" value={text(form, "section_code")} onChange={(event) => updateForm("section_code", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-shift">Default shift</label><select id="master-shift" value={text(form, "default_shift")} onChange={(event) => updateForm("default_shift", event.target.value)}><option value="">None</option><option value="DAY">DAY</option><option value="NIGHT">NIGHT</option></select></div>
                <div className="form-field"><label htmlFor="master-location">Location</label><select id="master-location" value={text(form, "location_id")} onChange={(event) => updateForm("location_id", event.target.value)}><option value="">None</option>{masters?.locations.map((location) => <option key={location.location_id} value={location.location_id}>{location.name_mr} ({location.kind})</option>)}</select></div>
                <div className="form-field"><label htmlFor="master-order">Display order</label><input id="master-order" type="number" min="0" value={text(form, "display_order")} onChange={(event) => updateForm("display_order", event.target.value)} /></div>
              </div>}
              {editor.tab === "locations" && <div className="form-grid">
                <div className="form-field"><label htmlFor="master-code">Location code *</label><input id="master-code" value={text(form, "location_code")} disabled={editor.mode === "edit"} onChange={(event) => updateForm("location_code", event.target.value.toUpperCase())} /></div>
                <div className="form-field"><label htmlFor="master-name">Name *</label><input id="master-name" value={text(form, "name_mr")} onChange={(event) => updateForm("name_mr", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-kind">Kind *</label><select id="master-kind" value={text(form, "kind")} onChange={(event) => updateForm("kind", event.target.value)}>{["STATION", "CHOWKI", "MARSHAL_POST", "OFFICE", "COURT", "FIXED_POINT"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>
                <div className="form-field"><label htmlFor="master-order">Display order</label><input id="master-order" type="number" min="0" value={text(form, "display_order")} onChange={(event) => updateForm("display_order", event.target.value)} /></div>
              </div>}
              {editor.tab === "units" && <div className="form-grid">
                <div className="form-field"><label htmlFor="master-code">Unit code *</label><input id="master-code" value={text(form, "unit_code")} disabled={editor.mode === "edit"} onChange={(event) => updateForm("unit_code", event.target.value.toUpperCase())} /></div>
                <div className="form-field"><label htmlFor="master-name">Name *</label><input id="master-name" value={text(form, "name_mr")} onChange={(event) => updateForm("name_mr", event.target.value)} /></div>
                <div className="form-field"><label htmlFor="master-unit-type">Type *</label><select id="master-unit-type" value={text(form, "unit_type")} onChange={(event) => updateForm("unit_type", event.target.value)}><option value="PATROL_MOBILE">PATROL_MOBILE</option><option value="CHOWKI_INCHARGE">CHOWKI_INCHARGE</option></select></div>
                <div className="form-field"><label htmlFor="master-order">Display order</label><input id="master-order" type="number" min="0" value={text(form, "display_order")} onChange={(event) => updateForm("display_order", event.target.value)} /></div>
              </div>}
              <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={active(form)} onChange={(event) => updateForm("active", event.target.checked)} /> Active master row</label>
              <div className="form-actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button></div>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
