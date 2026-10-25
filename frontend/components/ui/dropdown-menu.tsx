/**
 * Purpose: Accessible non-modal action/navigation menus over the shared shell.
 * Current role: Semantic colors and portal layering above sticky toolbars.
 * Last meaningful change: 2026-10-18 — coordinated page/dialog popover layers.
 * Constraint: Non-modal menus never remove the page scrollbar.
 */
"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/components/ui/cn";
import { useDialogLayer } from "@/components/ui/dialog";

/** Action/navigation menus are non-modal: opening one must not lock the page scrollbar. */
export function DropdownMenu({ modal = false, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />;
}
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  const inDialog = useDialogLayer();
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn("ui-menu-content min-w-52 rounded-md border p-1.5 shadow-panel", inDialog && "ui-dialog-popover", className)} {...props} /></DropdownMenuPrimitive.Portal>;
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn("ui-menu-item flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("my-1 h-px bg-line-soft", className)} {...props} />;
}
