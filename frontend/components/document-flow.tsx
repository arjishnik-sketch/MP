"use client";

/**
 * Purpose: Responsive, independent lane stacks for the shared C1 document.
 * Current role: Normal DOM flow with a stable first left-to-right placement and no row-height coupling.
 * Last meaningful change: 2026-10-18 — source-preserving C1 lane layout.
 * Constraint: Packing changes presentation only; no data fetching or personnel choices.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { packFlowLanes } from "@/lib/document-flow";

export interface FlowItem {
  key: string;
  weight: number;
  content: ReactNode;
}

export function DocumentFlow({
  items,
  columns = 3,
  className = "",
  forceColumns = false,
}: {
  items: FlowItem[];
  columns?: number;
  className?: string;
  forceColumns?: boolean;
}) {
  const [width, setWidth] = useState(1440);
  const [isPrint, setIsPrint] = useState(false);
  useEffect(() => {
    const sync = () => {
      setWidth(window.innerWidth);
      if (typeof window.matchMedia === "function") {
        setIsPrint(window.matchMedia("print").matches);
      }
    };
    sync();
    window.addEventListener("resize", sync);
    const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onPrintChange = (e: MediaQueryListEvent) => {
      setIsPrint(e.matches);
      if (e.matches) setWidth(1440);
      else sync();
    };
    mql?.addEventListener("change", onPrintChange);
    const onBefore = () => { setIsPrint(true); setWidth(1440); };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", sync);
    return () => {
      window.removeEventListener("resize", sync);
      mql?.removeEventListener("change", onPrintChange);
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", sync);
    };
  }, []);
  const count = (forceColumns || isPrint)
    ? columns
    : width < 700 ? 1 : width < 1100 ? Math.min(columns, 2) : columns;
  const lanes = packFlowLanes(items, count, (item) => item.weight);
  return <div className={`c1-flow ${className}`.trim()} style={{ "--flow-columns": count } as CSSProperties}>
    {lanes.map((lane, index) => <div className="c1-flow-lane" key={index}>
      {lane.map((item) => <div className="c1-flow-item" key={item.key}>{item.content}</div>)}
    </div>)}
  </div>;
}
