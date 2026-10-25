/**
 * Purpose: Existing frontend utility configuration over shared semantic colors.
 * Current role: Let route/module styles use the same light/dark roles as primitives.
 * Last meaningful change: 2026-10-18 — semantic color and type roles.
 * Constraint: This hand-authored Radix stack has no registry preset dependency.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        "brand-blue": "var(--brand-blue)",
        navy: "var(--navy)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        paper: "var(--paper)",
        surface: { DEFAULT: "var(--surface)", muted: "var(--surface-muted)" },
        line: { DEFAULT: "var(--line)", soft: "var(--line-soft)" },
        band: "var(--band)",
        amber: "var(--amber)",
        bima: "var(--bima)",
        danger: "var(--danger)",
        success: "var(--success)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
      },
      fontSize: {
        "page-title": ["var(--type-page-title)", "1.25"],
        "section-title": ["var(--type-section)", "1.4"],
        "field-label": ["var(--type-label)", "1.4"],
        "field-value": ["var(--type-value)", "1.5"],
      },
    },
  },
  plugins: [],
};

export default config;
