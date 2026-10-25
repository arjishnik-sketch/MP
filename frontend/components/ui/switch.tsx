/**
 * Purpose: Shared accessible Radix switch.
 * Current role: Theme-aware switch track with a contrasting fixed thumb.
 * Last meaningful change: 2026-10-18 — semantic control colors.
 * Constraint: Checked state is explicit UI state, never inferred from chart notes.
 */
"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/components/ui/cn";

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={cn("ui-switch inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}><SwitchPrimitive.Thumb className="ui-switch-thumb pointer-events-none block h-4 w-4 rounded-full shadow-sm transition-transform data-[state=checked]:translate-x-4" /></SwitchPrimitive.Root>;
}
