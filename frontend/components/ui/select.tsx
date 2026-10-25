/**
 * Purpose: Shared accessible Radix Select with a normal anchored viewport.
 * Current role: Semantic controls, constrained option scrolling and portal layers.
 * Last meaningful change: 2026-10-18 — compatible Select scroll-lock/gutter treatment.
 * Constraint: Radix Select is modal; globals reserve its gutter exactly once.
 */
"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/components/ui/cn";
import { ChevronDown } from "@/components/ui/icons";
import { useDialogLayer } from "@/components/ui/dialog";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn("ui-select-trigger inline-flex h-9 min-w-32 items-center justify-between gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown /></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}

export function SelectContent({ className, children, position = "popper", sideOffset = 5, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  const inDialog = useDialogLayer();
  return <SelectPrimitive.Portal><SelectPrimitive.Content className={cn("ui-select-content overflow-hidden rounded-md border shadow-panel", inDialog && "ui-dialog-popover", className)} position={position} sideOffset={sideOffset} {...props}><SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>;
}

export function SelectItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn("ui-select-item relative flex cursor-pointer select-none items-center rounded px-3 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props}><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>;
}
