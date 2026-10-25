/**
 * Purpose: Shared frontend document and local pre-paint theme bootstrap.
 * Current role: Apply the saved theme before any route or dialog is painted.
 * Last meaningful change: 2026-10-18 — guarded inline light/dark initialization.
 * Constraint: No remote theme service, font or script dependency.
 */
import type { Metadata } from "next";
import "./globals.css";
import "./chart.css";
import { AppShell } from "@/components/app-shell";
import { THEME_BOOTSTRAP } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Panchavati Daily Duty",
  description: "Local daily duty chart editor for Panchavati Police Station",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} /></head><body><AppShell>{children}</AppShell></body></html>;
}
