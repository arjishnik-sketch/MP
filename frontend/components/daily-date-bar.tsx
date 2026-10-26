"use client";

/**
 * Purpose: Shared date context bar across all Daily Work pages.
 * Displays selected date, weekday, lifecycle status, quick shortcuts (Today, Tomorrow),
 * and a direct link to the full visual Chart Preview.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { localDateIso, weekdayMr } from "@/lib/format";
import { chartDateLabel } from "@/lib/chart-document-layout";
import { useLocale } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { ChartReference } from "@/lib/types";

interface DailyDateBarProps {
  date: string;
  onDateChange?: (newDate: string) => void;
  lifecycle?: "DRAFT" | "VALIDATED" | "FINALIZED";
  stats?: {
    totalSeats?: number;
    filledSeats?: number;
    vacantSeats?: number;
  };
}

export function DailyDateBar({
  date,
  onDateChange,
  lifecycle,
  stats,
}: DailyDateBarProps) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const today = localDateIso();

  // Compute tomorrow
  const tomorrow = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const handleDateSelect = (nextDate: string) => {
    if (onDateChange) {
      onDateChange(nextDate);
    } else {
      router.push(`?date=${nextDate}`);
    }
  };

  const lifecycleLabel = {
    DRAFT: locale === "mr" ? "मसुदा (DRAFT)" : "Draft",
    VALIDATED: locale === "mr" ? "पडताळलेला (VALIDATED)" : "Validated",
    FINALIZED: locale === "mr" ? "अंतिम (FINALIZED)" : "Finalized",
  };

  const lifecycleTone: Record<string, "amber" | "blue" | "green" | "outline"> = {
    DRAFT: "amber",
    VALIDATED: "blue",
    FINALIZED: "green",
  };

  return (
    <div className="daily-date-bar-wrapper">
      <div className="daily-date-bar-inner">
        <div className="daily-date-context">
          <span className="daily-date-bar-label">
            {locale === "mr" ? "निवडलेला दिनांक:" : "Selected Date:"}
          </span>
          <strong className="daily-date-display">
            {chartDateLabel(date)}, {weekdayMr(date)}
          </strong>
          {lifecycle && (
            <Badge tone={lifecycleTone[lifecycle] || "outline"}>
              {lifecycleLabel[lifecycle]}
            </Badge>
          )}
        </div>

        <div className="daily-date-actions">
          <div className="daily-date-quick-buttons">
            <button
              type="button"
              className={buttonClassName({
                variant: date === today ? "primary" : "secondary",
                size: "sm",
              })}
              onClick={() => handleDateSelect(today)}
            >
              {locale === "mr" ? "आज" : "Today"}
            </button>
            <button
              type="button"
              className={buttonClassName({
                variant: date === tomorrow ? "primary" : "secondary",
                size: "sm",
              })}
              onClick={() => handleDateSelect(tomorrow)}
            >
              {locale === "mr" ? "उद्या" : "Tomorrow"}
            </button>
          </div>

          <label className="daily-date-picker-label">
            <input
              type="date"
              className="daily-date-input"
              value={date}
              onChange={(e) => {
                if (e.target.value) handleDateSelect(e.target.value);
              }}
            />
          </label>

          <Link
            href={`/charts/${date}`}
            className={buttonClassName({ variant: "outline", size: "sm" })}
          >
            {locale === "mr" ? "तक्ता पूर्वावलोकन उघडा →" : "Open Chart Preview →"}
          </Link>
        </div>
      </div>

      {stats && typeof stats.totalSeats === "number" && stats.totalSeats > 0 && (
        <div className="daily-date-progress-row">
          <span className="daily-progress-text">
            {locale === "mr"
              ? `${stats.filledSeats ?? 0} पैकी ${stats.totalSeats} कर्तव्य जागा भरल्या आहेत (${stats.vacantSeats ?? 0} रिक्त)`
              : `${stats.filledSeats ?? 0} of ${stats.totalSeats} duty seats filled (${stats.vacantSeats ?? 0} vacant)`}
          </span>
          <div className="daily-progress-track">
            <div
              className="daily-progress-fill"
              style={{
                width: `${Math.min(100, Math.round(((stats.filledSeats ?? 0) / stats.totalSeats) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
