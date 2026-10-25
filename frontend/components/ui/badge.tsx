/**
 * Purpose: Shared text-labelled semantic status badges.
 * Current role: Readable status tones in light and dark surfaces.
 * Last meaningful change: 2026-10-18 — semantic tone tokens.
 * Constraint: Color supplements the badge label; it never replaces it.
 */
import type { HTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";

export function Badge({ className, tone = "slate", ...props }: HTMLAttributes<HTMLSpanElement> & {
  tone?: "slate" | "amber" | "blue" | "green" | "red" | "outline";
}) {
  const tones = {
    slate: "ui-badge-neutral",
    amber: "ui-badge-warning",
    blue: "ui-badge-info",
    green: "ui-badge-success",
    red: "ui-badge-danger",
    outline: "ui-badge-outline",
  } as const;
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
}
