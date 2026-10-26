"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { persistLocalePreference, readLocalePreference, type Locale } from "./locale-storage";

export type { Locale } from "./locale-storage";

const dictionary = {
  en: {
    dashboard: "Dashboard",
    dailyWork: "Daily Work",
    dailyCharts: "Daily Duty Charts",
    chartPreview: "Chart Preview",
    assignDuties: "Assign & Manage Duties",
    leaveAttachments: "Leave & Attachments",
    standingCharges: "Standing Charges",
    chartRegisters: "Chart Registers",
    allCharts: "All Daily Duty Charts",
    versions: "Versions / Amendments",
    importOld: "Import Old Charts",
    staffAndMasters: "Staff & Masters",
    manageStaff: "Manage Staff",
    staffRecords: "Staff records",
    dailyAttendance: "Daily attendance",
    dutyCatalog: "Duty Catalog",
    masterData: "Master Data",
    ranks: "Ranks",
    duties: "Duties",
    locations: "Locations / Chowkis",
    units: "Units / Mobiles",
    strengthConfig: "Strength Configuration",
    eventTypes: "Event Types/Equipment",
    importData: "Import",
    historyAndReports: "History & Reports",
    history: "History",
    savedCharts: "Saved Charts",
    dutyHistory: "Duty History",
    attendanceHistory: "Attendance History",
    monthlyAttendance: "Monthly Attendance",
    printExport: "Print / Export",
    reports: "Reports",
    integrations: "Integrations",
    whatsapp: "WhatsApp",
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
    dailyWork: "दैनिक काम",
    dailyCharts: "दैनिक कर्तव्य तक्ते",
    chartPreview: "तक्ता पूर्वावलोकन",
    assignDuties: "कर्तव्य वाटप व व्यवस्थापन",
    leaveAttachments: "रजा व इतर कर्तव्ये",
    standingCharges: "स्टँडिंग चार्जेस",
    chartRegisters: "तक्ता नोंदवह्या",
    allCharts: "सर्व दैनिक कर्तव्य तक्ते",
    versions: "आवृत्त्या / फेरबदल",
    importOld: "जुने तक्ते आयात करा",
    staffAndMasters: "कर्मचारी व मास्टर्स",
    manageStaff: "कर्मचारी व्यवस्थापन",
    staffRecords: "कर्मचारी नोंदी",
    dailyAttendance: "दैनंदिन हजेरी",
    dutyCatalog: "कर्तव्य सूची (कॅटलॉग)",
    masterData: "मास्टर डेटा",
    ranks: "हुद्दे",
    duties: "कर्तव्ये",
    locations: "ठिकाणे / चौक्या / मार्शल",
    units: "युनिट / मोबाईल",
    strengthConfig: "संख्याबळ संरचना",
    eventTypes: "कार्यक्रम प्रकार / साहित्य",
    importData: "आयात",
    historyAndReports: "इतिहास व अहवाल",
    history: "इतिहास",
    savedCharts: "जतन केलेले तक्ते",
    dutyHistory: "कर्तव्य इतिहास",
    attendanceHistory: "हजेरी इतिहास",
    monthlyAttendance: "मासिक हजेरी अहवाल",
    printExport: "प्रिंट / निर्यात",
    reports: "अहवाल",
    integrations: "एकत्रीकरण (Integrations)",
    whatsapp: "WhatsApp",
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
