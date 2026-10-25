"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { persistLocalePreference, readLocalePreference, type Locale } from "./locale-storage";

export type { Locale } from "./locale-storage";

const dictionary = {
  en: {
    dashboard: "Dashboard",
    dailyCharts: "Daily Duty Charts",
    chartPreview: "Chart Preview & Editor",
    allCharts: "All Daily Duty Charts",
    versions: "Chart Templates",
    importOld: "Import Old Charts",
    manageStaff: "Manage Staff",
    staffRecords: "Staff records",
    dailyAttendance: "Daily attendance",
    masterData: "Master Data",
    ranks: "Ranks",
    duties: "Duties",
    locations: "Locations/Chowkis",
    units: "Units/Mobiles",
    eventTypes: "Event Types/Equipment",
    importData: "Import",
    history: "History",
    reports: "Reports",
    wip: "WIP",
    comingSoon: "Coming Soon",
    guest: "Guest",
    loggedInAs: "logged in as:",
    noChartToday: "No chart saved today",
    preview: "Preview",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    search: "Search",
    loading: "Loading…",
    error: "Something went wrong",
  },
  mr: {
    dashboard: "डॅशबोर्ड",
    dailyCharts: "दैनिक कर्तव्य तक्ते",
    chartPreview: "तक्ता पूर्वावलोकन व संपादन",
    allCharts: "सर्व दैनिक कर्तव्य तक्ते",
    versions: "तक्ता टेम्पलेट",
    importOld: "जुने तक्ते आयात करा",
    manageStaff: "कर्मचारी व्यवस्थापन",
    staffRecords: "कर्मचारी नोंदी",
    dailyAttendance: "दैनंदिन हजेरी",
    masterData: "मास्टर डेटा",
    ranks: "हुद्दे",
    duties: "कर्तव्ये",
    locations: "ठिकाणे / चौक्या",
    units: "युनिट / मोबाईल",
    eventTypes: "कार्यक्रम प्रकार / साहित्य",
    importData: "आयात",
    history: "इतिहास",
    reports: "अहवाल",
    wip: "WIP",
    comingSoon: "लवकरच उपलब्ध",
    guest: "अतिथी",
    loggedInAs: "लॉग इन:",
    noChartToday: "आजचा तक्ता जतन केलेला नाही",
    preview: "पूर्वावलोकन",
    edit: "संपादन",
    save: "जतन करा",
    cancel: "रद्द करा",
    close: "बंद करा",
    search: "शोधा",
    loading: "लोड होत आहे…",
    error: "काहीतरी चुकले",
  },
} as const;

type TranslationKey = keyof typeof dictionary.en;
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: TranslationKey) => string };

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const next = readLocalePreference(() => window.localStorage);
    setLocaleState(next);
    document.documentElement.lang = next;
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    persistLocalePreference(() => window.localStorage, next);
    document.documentElement.lang = next;
  };

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => dictionary[locale][key],
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
