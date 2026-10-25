/**
 * Purpose: Persistent production identity and grouped navigation shell.
 * Current role: Station identity, navigation, persistent theme, locale and clerk block.
 * Last meaningful change: 2026-10-18 — shared theme and measured sticky-header offset.
 * Constraint: Unfinished destinations remain disabled WIP entries.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/components/ui/cn";
import { ChevronDown } from "@/components/ui/icons";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import { localDateIso } from "@/lib/format";
import { ensureDailyDraft } from "@/lib/daily-start";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      className={cn("shell-nav-link", active && "is-active")}
      href={href}
    >
      {children}
    </Link>
  );
}

function WipItem({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  return (
    <DropdownMenuItem disabled className="shell-wip-item">
      <span>{children}</span>
      <span className="shell-status-badge">{t("wip")}</span>
    </DropdownMenuItem>
  );
}

function MenuTrigger({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuTrigger className="shell-nav-link shell-menu-trigger">
      <span>{children}</span>
      <ChevronDown />
    </DropdownMenuTrigger>
  );
}

function ChartPreviewMenuLink() {
  const { t } = useLocale();
  const [href, setHref] = useState("/charts");

  useEffect(() => {
    setHref(`/charts/${localDateIso()}`);
  }, []);

  return (
    <DropdownMenuItem asChild>
      <Link href={href} className="shell-menu-link">
        <span>{t("chartPreview")}</span>
      </Link>
    </DropdownMenuItem>
  );
}

function Header() {
  const { locale, setLocale, t } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const toggleLocale = () => setLocale(locale === "en" ? "mr" : "en");
  const themeAction = locale === "mr"
    ? theme === "dark" ? "हलकी रंगसंगती वापरा" : "गडद रंगसंगती वापरा"
    : theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = () => document.documentElement.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    updateHeight();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateHeight) : null;
    observer?.observe(header);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  return (
    <header ref={headerRef} className="app-header">
      <div className="app-header-inner">
        <Link
          href="/dashboard"
          className="station-identity"
          aria-label={locale === "mr" ? "पंचवटी पोलीस ठाणे डॅशबोर्ड" : "Panchavati Police Station dashboard"}
        >
          <img
            className="station-logo"
            src="/assets/police-logo.png"
            alt="Maharashtra Police"
          />
          <span className="station-lockup">
            <strong>{locale === "mr" ? "पंचवटी पोलीस ठाणे" : "Panchavati Police Station"}</strong>
            <span>{locale === "mr" ? "नाशिक शहर" : "Nashik City"}</span>
          </span>
        </Link>

        <nav className="shell-nav" aria-label="Main navigation">
          <NavLink href="/dashboard">{t("dashboard")}</NavLink>
          <DropdownMenu>
             <MenuTrigger>{t("dailyCharts")}</MenuTrigger>
             <DropdownMenuContent align="start" className="shell-menu-content shell-menu-wide">
               <DropdownMenuGroup>
                 <ChartPreviewMenuLink />
                 <DropdownMenuItem asChild>
                   <Link href="/charts">{t("allCharts")}</Link>
                 </DropdownMenuItem>
                <WipItem>{t("versions")}</WipItem>
                <DropdownMenuSeparator />
                <WipItem>{t("importOld")}</WipItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn("shell-nav-link shell-menu-trigger", pathname.startsWith("/staff") && "is-active")}>
              <span>{t("manageStaff")}</span><ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="shell-menu-content">
              <DropdownMenuGroup>
                <DropdownMenuItem asChild><Link href="/staff">{t("staffRecords")}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/staff/attendance">{t("dailyAttendance")}</Link></DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <NavLink href="/master-data">{t("masterData")}</NavLink>
          <NavLink href="/history">{t("history")}</NavLink>
          <NavLink href="/reports">{t("reports")}</NavLink>
        </nav>

        <div className="header-actions">
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={themeAction}
            aria-pressed={theme === "dark"}
            title={themeAction}
          >
            <svg className="theme-icon-light" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
            <svg className="theme-icon-dark" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          </button>
          <button
            type="button"
            onClick={toggleLocale}
            className="language-toggle"
            aria-label="Toggle interface language"
          >
            <span className={locale === "en" ? "is-current" : ""}>EN</span>
            <span aria-hidden="true">/</span>
            <span className={locale === "mr" ? "is-current" : ""}>MR</span>
          </button>
          <div className="logged-in-block">
            <small>{t("loggedInAs")}</small>
            <strong>{t("guest")}</strong>
          </div>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const lastStartedDate = useRef("");
  useEffect(() => {
    let alive = true;
    const startDay = () => {
      if (document.hidden) return;
      const today = localDateIso();
      if (today === lastStartedDate.current) return;
      // The POST is idempotent, including concurrent tabs/React strict-mode mounts.
      void ensureDailyDraft(today).then(() => { if (alive) lastStartedDate.current = today; }).catch(() => {
        // Dashboard/chart/attendance show actionable API errors, not a shell-wide blocker.
      });
    };
    startDay();
    const interval = window.setInterval(startDay, 60_000);
    window.addEventListener("focus", startDay);
    document.addEventListener("visibilitychange", startDay);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", startDay);
      document.removeEventListener("visibilitychange", startDay);
    };
  }, []);
  return (
    <ThemeProvider>
      <LocaleProvider>
        <Header />
        <main className="app-main">{children}</main>
      </LocaleProvider>
    </ThemeProvider>
  );
}
