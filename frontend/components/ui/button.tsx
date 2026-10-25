/**
 * Purpose: Shared button grammar for all routes and authoring dialogs.
 * Current role: Semantic light/dark states without literal palette dependencies.
 * Last meaningful change: 2026-10-18 — theme-aware control roles.
 * Constraint: Brand-filled primary actions retain the station's exact brand color.
 */
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

export function buttonClassName({ variant = "secondary", size = "md", className = "" }: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const variants: Record<ButtonVariant, string> = {
    primary: "ui-button-primary",
    secondary: "ui-button-secondary",
    ghost: "ui-button-ghost",
    danger: "ui-button-danger",
    outline: "ui-button-outline",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "min-h-8 px-2.5 text-xs",
    md: "min-h-9 px-3 text-sm",
    lg: "min-h-10 px-4 text-sm",
  };
  return cn(
    "ui-button inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    variants[variant], sizes[size], className,
  );
}

export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClassName({ variant, size, className })} {...props} />;
}
