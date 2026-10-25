"use client";

/**
 * Purpose: Compact person labels with full-name access and keyboard/hover rank expansion.
 * Current role: Dashboard rank help, placed upper-right and clamped to the visible viewport.
 * Last meaningful change: 2026-10-18 — upper-right rank-only tooltip positioning.
 * Constraint: Person/rank data is display-only; portal avoids clipping in dense cards.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compactPersonLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { rankExpansion } from "@/lib/rank-label";
import type { Person } from "@/lib/types";
import styles from "./rank-label.module.css";

export function RankLabel({ person }: { person: Person }) {
  const { locale } = useLocale();
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const abbreviation = person.rankShortFormMr || person.rankCode;
  const expansion = rankExpansion(person, locale);

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => { cancelClose(); setOpen(true); };
  const hideSoon = () => {
    cancelClose();
    if (anchor.current === document.activeElement) return;
    closeTimer.current = setTimeout(() => { setOpen(false); setPosition(null); }, 120);
  };
  const close = () => { cancelClose(); setOpen(false); setPosition(null); };

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tooltip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const help = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(rect.right + 5, window.innerWidth - help.width - 8)),
      top: Math.max(help.height + 8, rect.top - 6),
    });
  }, [open, expansion]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => { setOpen(false); setPosition(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => () => { if (closeTimer.current !== null) clearTimeout(closeTimer.current); }, []);

  return <>
    <span ref={anchor} className={styles.rank} tabIndex={0} lang="mr"
      aria-label={abbreviation} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={close}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      {abbreviation}
    </span>
    {open && createPortal(<span ref={tooltip} id={id} role="tooltip" lang={locale} data-placement="upper-right"
      className={styles.tooltip}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
      onMouseEnter={cancelClose} onMouseLeave={hideSoon}>{expansion}</span>, document.body)}
  </>;
}

export function CompactPersonLabel({ person }: { person: Person }) {
  const abbreviation = person.rankShortFormMr || person.rankCode;
  const compact = compactPersonLabel(person).slice(abbreviation.length).trimStart();
  return <span className={styles.person} lang="mr">
    <RankLabel person={person} />{" "}
    <span title={person.nameMr}>
      <span aria-hidden="true">{compact}</span>
      <span className={styles.srOnly}>{person.buckleNo ? `${person.buckleNo} ` : ""}{person.nameMr}</span>
    </span>
  </span>;
}
