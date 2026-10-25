/**
 * Purpose: Locale-specific help for rank abbreviations without changing chart labels.
 * Current role: Expand known rank codes in English; retain recorded Marathi rank names verbatim.
 * Last meaningful change: 2026-10-18 — compact dashboard person labels with accessible rank help.
 * Constraint: Display-only metadata; no rank, cadre or operational-role inference.
 */
import type { Person } from "./types";

const rankNames: Record<string, { en: string; mr: string }> = {
  SR_PI: { en: "Senior Police Inspector", mr: "वरिष्ठ पोलीस निरीक्षक" },
  PI: { en: "Police Inspector", mr: "पोलीस निरीक्षक" },
  API: { en: "Assistant Police Inspector", mr: "सहाय्यक पोलीस निरीक्षक" },
  PSI: { en: "Police Sub-Inspector", mr: "पोलीस उपनिरीक्षक" },
  PROB_PSI: { en: "Probationary Police Sub-Inspector", mr: "परिविक्षाधीन पोलीस उपनिरीक्षक" },
  PROB_LPSI: { en: "Probationary Woman Police Sub-Inspector", mr: "परिविक्षाधीन महिला पोलीस उपनिरीक्षक" },
  GRADE_PSI: { en: "Grade Police Sub-Inspector", mr: "ग्रेड पोलीस उपनिरीक्षक" },
  GPS: { en: "Grade Police Sub-Inspector", mr: "ग्रेड पोलीस उपनिरीक्षक" },
  ASI: { en: "Assistant Police Sub-Inspector", mr: "सहाय्यक पोलीस उपनिरीक्षक" },
  LASI: { en: "Woman Assistant Police Sub-Inspector", mr: "महिला सहाय्यक पोलीस उपनिरीक्षक" },
  HC: { en: "Police Head Constable", mr: "पोलीस हवालदार" },
  DRIVER_HC: { en: "Driver Police Head Constable", mr: "चालक पोलीस हवालदार" },
  LHC: { en: "Woman Police Head Constable", mr: "महिला पोलीस हवालदार" },
  PN: { en: "Police Naik", mr: "पोलीस नाईक" },
  LPN: { en: "Woman Police Naik", mr: "महिला पोलीस नाईक" },
  PC: { en: "Police Constable", mr: "पोलीस शिपाई" },
  DRIVER_PC: { en: "Driver Police Constable", mr: "चालक पोलीस शिपाई" },
  LPC: { en: "Woman Police Constable", mr: "महिला पोलीस शिपाई" },
  HOME_GUARD: { en: "Home Guard", mr: "होम गार्ड" },
};

export function rankExpansion(person: Pick<Person, "rankCode" | "rankNameMr" | "rankShortFormMr">, locale: "en" | "mr"): string {
  if (locale === "en") return rankNames[person.rankCode]?.en ?? person.rankCode;
  const recorded = person.rankNameMr?.trim();
  if (!recorded) return rankNames[person.rankCode]?.mr ?? person.rankCode;
  // The master name can include its own abbreviation. Omit that exact suffix in help only.
  const suffix = person.rankShortFormMr ? ` (${person.rankShortFormMr})` : "";
  return suffix && recorded.endsWith(suffix) ? recorded.slice(0, -suffix.length) : recorded;
}
