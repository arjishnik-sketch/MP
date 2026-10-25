"use client";

/**
 * Purpose: Compact, localized chart document controls.
 * Current role: Bounded saved-date navigation, view mode and existing share/export actions.
 * Last meaningful change: 2026-10-18 — Radix date-menu dismissal, internal scrolling and yesterday shortcut.
 * Constraint: Missing dates are explicit disabled options; navigation never creates a chart.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { ChartReference } from "@/lib/types";
import { localDateIso } from "@/lib/format";
import { buildToolbarDateGroups, toolbarDateLabel, toolbarWeekday, type ToolbarDateOption } from "@/lib/toolbar-dates";
import { useLocale } from "@/lib/i18n";
import { buttonClassName } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, SearchIcon } from "@/components/ui/icons";
import type { PaperSize, PaperOrientation, LayoutMode } from "@/lib/chart-layout-engine";
import styles from "./chart-toolbar.module.css";

const COPY = {
  en: {
    date: "Date", chooseDate: "Choose chart date", searchDates: "Search dates…", advanced: "Open advanced date search", today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday", saved: "Saved history",
    noChart: "No chart saved", noSaved: "No other saved chart dates.", noMatches: "No matching dates.", loading: "Loading saved dates…", loadError: "Saved dates could not be loaded.",
    version: "Version", current: "Current chart", versions: "Versions / templates", modes: "Preview or edit mode", preview: "Preview", edit: "Edit",
    paper: "Paper", orientation: "Orientation", landscape: "Landscape", portrait: "Portrait",
    viewMode: "View", paginated: "Pages", continuous: "Continuous",
    share: "Share", shareChart: "Share chart", email: "Email", whatsapp: "WhatsApp", export: "Export", exportChart: "Export chart", comingSoon: "Coming Soon",
    pdfHint: (size: string, isLand: boolean) => `For PDF, select ${size} ${isLand ? "Landscape" : "Portrait"}, background graphics ON, and margins NONE in print dialog.`,
    statuses: { DRAFT: "Draft", VALIDATED: "Validated", FINALIZED: "Finalized" },
  },
  mr: {
    date: "दिनांक", chooseDate: "तक्त्याचा दिनांक निवडा", searchDates: "दिनांक शोधा…", advanced: "सविस्तर दिनांक शोध उघडा", today: "आज", tomorrow: "उद्या", yesterday: "काल", saved: "जतन केलेले तक्ते",
    noChart: "तक्ता जतन केलेला नाही", noSaved: "इतर जतन केलेले तक्ते नाहीत.", noMatches: "जुळणारे दिनांक नाहीत.", loading: "जतन केलेले दिनांक लोड होत आहेत…", loadError: "जतन केलेले दिनांक लोड झाले नाहीत.",
    version: "आवृत्ती", current: "सध्याचा तक्ता", versions: "आवृत्त्या / टेम्पलेट", modes: "पूर्वावलोकन किंवा संपादन", preview: "पूर्वावलोकन", edit: "संपादन",
    paper: "कागद", orientation: "मांडणी", landscape: "आडवे", portrait: "उभे",
    viewMode: "दृश्य", paginated: "पृष्ठ", continuous: "सलग",
    share: "पाठवा", shareChart: "तक्ता पाठवा", email: "ईमेल", whatsapp: "WhatsApp", export: "निर्यात", exportChart: "तक्ता निर्यात करा", comingSoon: "लवकरच उपलब्ध",
    pdfHint: (size: string, isLand: boolean) => `PDF साठी मुद्रण संवादात ${size} ${isLand ? "आडवे पान (Landscape)" : "उभे पान (Portrait)"} निवडा, पार्श्वभूमीचे रंग सुरू ठेवा आणि मार्जिन None ठेवा.`,
    statuses: { DRAFT: "मसुदा", VALIDATED: "पडताळलेला", FINALIZED: "अंतिम" },
  },
} as const;

function DatePicker({ date }: { date: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [references, setReferences] = useState<ChartReference[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<ChartReference[]>("/api/charts").then((items) => {
      if (active) { setReferences(items); setLoadState("ready"); }
    }).catch(() => { if (active) setLoadState("error"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    // DropdownMenu owns dismissal/restoration; the search field owns initial entry focus.
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const today = localDateIso();
  const groups = useMemo(() => buildToolbarDateGroups(references, today, query), [references, today, query]);
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) setQuery(""); };
  const navigate = (nextDate: string) => { changeOpen(false); router.push(`/charts/${nextDate}`); };
  const renderDate = (option: ToolbarDateOption) => (
    <DropdownMenuItem
      key={option.date}
      className={styles.dateOption}
      disabled={!option.lifecycle || loadState !== "ready"}
      data-date-option=""
      data-current={option.date === date || undefined}
      aria-current={option.date === date ? "date" : undefined}
      textValue={`${toolbarDateLabel(option.date, locale)} ${toolbarWeekday(option.date, locale)}`}
      onSelect={() => navigate(option.date)}
    >
      <span className={styles.dateValue}><span>{toolbarDateLabel(option.date, locale)}</span><span className={styles.weekday}>{toolbarWeekday(option.date, locale)}</span></span>
      <span className={styles.dateStatus}>{loadState === "loading" ? copy.loading : loadState === "error" ? copy.loadError : option.lifecycle ? copy.statuses[option.lifecycle] : copy.noChart}</span>
    </DropdownMenuItem>
  );

  return <div className={styles.dateControl}>
    <span className={styles.label}>{copy.date}</span>
    <DropdownMenu open={open} onOpenChange={changeOpen} modal={false}>
      <DropdownMenuTrigger className={buttonClassName({ variant: "secondary", size: "sm", className: styles.dateTrigger })} aria-label={`${copy.chooseDate}: ${toolbarDateLabel(date, locale)}, ${toolbarWeekday(date, locale)}`}>
        <span className={styles.triggerValue}>{toolbarDateLabel(date, locale)} <span className={styles.weekday}>{toolbarWeekday(date, locale)}</span></span><ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" collisionPadding={12} className={styles.datePopover} aria-label={copy.chooseDate}>
        <div className={styles.searchRow}>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchDates}
            aria-label={copy.searchDates}
            onKeyDown={(event) => {
              if (event.key === "Escape") return;
              // Text entry must not trigger Radix menu typeahead or its Space/Tab handlers.
              event.stopPropagation();
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const options = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[data-date-option]:not([data-disabled])');
                const target = event.key === "ArrowUp" ? options?.[options.length - 1] : options?.[0];
                target?.focus();
              }
            }}
          />
          <DropdownMenuItem asChild className={styles.advancedSearch}>
            <Link href="/history" aria-label={copy.advanced} title={copy.advanced}><SearchIcon /></Link>
          </DropdownMenuItem>
        </div>
        <div className={styles.dateList}>
          {groups.map((group) => <DropdownMenuGroup key={group.id}>
            <DropdownMenuLabel className={styles.groupLabel}>{copy[group.id]}</DropdownMenuLabel>
            {group.options.map(renderDate)}
            {group.id === "saved" && !group.options.length && <p className={styles.empty}>{loadState === "loading" ? copy.loading : loadState === "error" ? copy.loadError : copy.noSaved}</p>}
          </DropdownMenuGroup>)}
          {!groups.length && <p className={styles.empty} role="status">{copy.noMatches}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function ShareMenu() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  return <DropdownMenu>
    <DropdownMenuTrigger className={buttonClassName({ variant: "secondary", size: "sm" })} aria-label={copy.shareChart}>{copy.share} <ChevronDown /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className={styles.actionMenu}>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled className={styles.pendingAction}><span>{copy.email}</span><span>{copy.comingSoon}</span></DropdownMenuItem>
        <DropdownMenuItem disabled className={styles.pendingAction}><span>{copy.whatsapp}</span><span>{copy.comingSoon}</span></DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ExportMenu({ paperSize, orientation }: { paperSize?: PaperSize; orientation?: PaperOrientation }) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const size = paperSize ?? "A4";
  const isLand = (orientation ?? "LANDSCAPE") === "LANDSCAPE";
  return <DropdownMenu>
    <DropdownMenuTrigger className={buttonClassName({ variant: "primary", size: "sm" })} aria-label={copy.exportChart}>{copy.export} <ChevronDown /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className={styles.actionMenu}>
      <DropdownMenuLabel>{copy.export}</DropdownMenuLabel>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => window.print()}>PDF ({size})</DropdownMenuItem>
        <DropdownMenuItem disabled className={styles.pendingAction}><span>PNG</span><span>{copy.comingSoon}</span></DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <p className={styles.exportInstruction}>{copy.pdfHint(size, isLand)}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export interface ChartToolbarProps {
  date: string;
  editMode: boolean;
  onEditModeChange: (value: boolean) => void;
  lifecycle: string;
  onReload?: () => void;
  paperSize?: PaperSize;
  onPaperSizeChange?: (size: PaperSize) => void;
  orientation?: PaperOrientation;
  onOrientationChange?: (orientation: PaperOrientation) => void;
  layoutMode?: LayoutMode;
  onLayoutModeChange?: (mode: LayoutMode) => void;
}

export function ChartToolbar({
  date,
  editMode,
  onEditModeChange,
  lifecycle,
  onReload,
  paperSize = "A4",
  onPaperSizeChange,
  orientation = "LANDSCAPE",
  onOrientationChange,
  layoutMode = "PAGINATED",
  onLayoutModeChange,
}: ChartToolbarProps) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  return <div className={`chart-toolbar ${styles.toolbar}`}>
    <div className={styles.versionField}>
      <span className={styles.label}>{copy.version}</span>
      <Select value="current" onValueChange={(value) => { if (value !== "current") onReload?.(); }}>
        <SelectTrigger aria-label={copy.version}><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="current">{copy.current}</SelectItem><SelectItem value="wip" disabled>{copy.versions} ({copy.comingSoon})</SelectItem></SelectGroup></SelectContent>
      </Select>
    </div>
    <DatePicker date={date} />

    {/* Paper Size selector */}
    <div className={styles.paperControl} role="group" aria-label={copy.paper}>
      <span className={styles.label}>{copy.paper}</span>
      <div className={styles.viewToggle}>
        <button
          type="button"
          onClick={() => onPaperSizeChange?.("A4")}
          aria-pressed={paperSize === "A4"}
          title="A4 (210 × 297 mm)"
        >
          A4
        </button>
        <button
          type="button"
          onClick={() => onPaperSizeChange?.("A3")}
          aria-pressed={paperSize === "A3"}
          title="A3 (297 × 420 mm)"
        >
          A3
        </button>
      </div>
    </div>

    {/* Orientation selector */}
    <div className={styles.paperControl} role="group" aria-label={copy.orientation}>
      <span className={styles.label}>{copy.orientation}</span>
      <div className={styles.viewToggle}>
        <button
          type="button"
          onClick={() => onOrientationChange?.("LANDSCAPE")}
          aria-pressed={orientation === "LANDSCAPE"}
          title={copy.landscape}
        >
          {copy.landscape}
        </button>
        <button
          type="button"
          onClick={() => onOrientationChange?.("PORTRAIT")}
          aria-pressed={orientation === "PORTRAIT"}
          title={copy.portrait}
        >
          {copy.portrait}
        </button>
      </div>
    </div>

    {/* Layout View Mode toggle */}
    <div className={styles.paperControl} role="group" aria-label={copy.viewMode}>
      <span className={styles.label}>{copy.viewMode}</span>
      <div className={styles.viewToggle}>
        <button
          type="button"
          onClick={() => onLayoutModeChange?.("PAGINATED")}
          aria-pressed={layoutMode === "PAGINATED"}
          title={copy.paginated}
        >
          {copy.paginated}
        </button>
        <button
          type="button"
          onClick={() => onLayoutModeChange?.("CONTINUOUS")}
          aria-pressed={layoutMode === "CONTINUOUS"}
          title={copy.continuous}
        >
          {copy.continuous}
        </button>
      </div>
    </div>

    <div className="chart-toolbar-spacer" />
    <div className={styles.viewToggle} role="group" aria-label={copy.modes}>
      <button type="button" onClick={() => onEditModeChange(false)} aria-pressed={!editMode}>{copy.preview}</button>
      <button type="button" onClick={() => onEditModeChange(true)} disabled={lifecycle === "FINALIZED"} aria-pressed={editMode}>{copy.edit}</button>
    </div>
    <ShareMenu />
    <ExportMenu paperSize={paperSize} orientation={orientation} />
  </div>;
}

