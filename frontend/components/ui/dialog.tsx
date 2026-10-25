/**
 * Purpose: Accessible shared Radix dialog with centralized overlay layers.
 * Current role: Theme-aware modal surface and context for its portalled controls.
 * Last meaningful change: 2026-10-18 — dialog and nested-popover layer roles.
 * Constraint: Modal focus/scroll behavior remains owned by Radix.
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext } from "react";
import { cn } from "@/components/ui/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const DialogLayerContext = createContext(false);
export function useDialogLayer() { return useContext(DialogLayerContext); }

export function DialogContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay fixed inset-0" />
      <DialogPrimitive.Content
        className={cn("ui-dialog-content fixed left-1/2 top-1/2 max-h-[90vh] w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border p-0 focus:outline-none", className)}
        {...props}
      >
        <DialogLayerContext.Provider value={true}>
          {children}
          <DialogPrimitive.Close className="ui-dialog-close absolute right-3 top-3 rounded p-1 text-xl leading-none" aria-label="Close dialog">×</DialogPrimitive.Close>
        </DialogLayerContext.Provider>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-dialog-header border-b px-5 py-4 pr-12", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("ui-dialog-description mt-1 text-sm", className)} {...props} />;
}
