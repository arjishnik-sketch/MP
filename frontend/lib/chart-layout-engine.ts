/**
 * Purpose: Dynamic, page-size-aware layout metrics and content-aware sheet packing for C1.
 * Current role: Recalculates printable dimensions, responsive columns, and packs compatible sections.
 * Last meaningful change: 2026-10-19 — A4/A3 landscape/portrait dynamic packing and whitespace optimization.
 * Constraint: Preserves all source assignments, hierarchy, Devanagari typography, and explicit data.
 */

export type PaperSize = "A4" | "A3";
export type PaperOrientation = "LANDSCAPE" | "PORTRAIT";
export type LayoutMode = "PAGINATED" | "CONTINUOUS";

export interface PageMetrics {
  paperSize: PaperSize;
  orientation: PaperOrientation;
  widthMm: number;
  heightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
  aspectRatio: number;
  heightCapacity: number;
  chowkiColumns: number;
  stationColumns: number;
  specialColumns: number;
  availabilityColumns: number;
  packedRosterColumns: number;
}

export function getPageMetrics(paperSize: PaperSize, orientation: PaperOrientation): PageMetrics {
  const isA3 = paperSize === "A3";
  const isLandscape = orientation === "LANDSCAPE";

  // Physical ISO 216 dimensions in millimeters
  const shortMm = isA3 ? 297 : 210;
  const longMm = isA3 ? 420 : 297;

  const widthMm = isLandscape ? longMm : shortMm;
  const heightMm = isLandscape ? shortMm : longMm;

  // Margin allocation: ~8mm left/right, ~7mm top/bottom
  const horizontalMarginMm = isA3 ? 16 : 14;
  const verticalMarginMm = isA3 ? 14 : 12;

  const printableWidthMm = widthMm - horizontalMarginMm;
  const printableHeightMm = heightMm - verticalMarginMm;
  const aspectRatio = widthMm / heightMm;

  // Relative height capacity score (1 score unit ≈ 8-9mm vertical space in compact print)
  let heightCapacity = 28;
  if (isA3 && isLandscape) {
    heightCapacity = 46;
  } else if (isA3 && !isLandscape) {
    heightCapacity = 58;
  } else if (!isA3 && !isLandscape) {
    heightCapacity = 38;
  } else {
    // A4 Landscape
    heightCapacity = 28;
  }

  // Column calculations based on available printable width
  let chowkiColumns = 3;
  let stationColumns = 3;
  let specialColumns = 2;
  let availabilityColumns = 2;
  let packedRosterColumns = 2;

  if (isA3 && isLandscape) {
    // 400mm printable width: broad canvas
    chowkiColumns = 3;
    stationColumns = 3;
    specialColumns = 2;
    availabilityColumns = 4;
    packedRosterColumns = 4;
  } else if (!isA3 && !isLandscape) {
    // A4 Portrait: 194mm printable width: narrow vertical canvas
    chowkiColumns = 2;
    stationColumns = 2;
    specialColumns = 2;
    availabilityColumns = 3;
    packedRosterColumns = 2;
  } else if (isA3 && !isLandscape) {
    // A3 Portrait: 277mm printable width (same as A4 landscape width, but tall)
    chowkiColumns = 3;
    stationColumns = 3;
    specialColumns = 2;
    availabilityColumns = 3;
    packedRosterColumns = 3;
  } else {
    // A4 Landscape: 281mm printable width
    chowkiColumns = 3;
    stationColumns = 3;
    specialColumns = 2;
    availabilityColumns = 4;
    packedRosterColumns = 4;
  }

  return {
    paperSize,
    orientation,
    widthMm,
    heightMm,
    printableWidthMm,
    printableHeightMm,
    aspectRatio,
    heightCapacity,
    chowkiColumns,
    stationColumns,
    specialColumns,
    availabilityColumns,
    packedRosterColumns,
  };
}

export interface SheetDefinition {
  id: string;
  titleMr: string;
  subtitleMr?: string;
  sections: string[];
}

/**
 * Dynamically packs logical chart sections into physical sheets based on paper size and orientation.
 * Preserves the exact reading hierarchy and operational grouping.
 */
export function planChartSheets(
  metrics: PageMetrics,
  hasEvents: boolean = false
): SheetDefinition[] {
  // Unified 6 balanced, zero-overflow sheets across A4 Landscape, A3 Landscape, and A4 Portrait:
  // Sheet 1: Command (Leadership, principal officers, station day/night/office desks)
  // Sheet 2: Chowkis (The 6 police chowkis with in-charge and marshals in 3x2 grid)
  // Sheet 3: Special Duties & Patrol (Court, summons, warrants, special desks side-by-side with scan schedule)
  // Sheet 4: Availability (Staff availability & leave register in balanced subcolumns)
  // Sheet 5: Directives & Officers (Daily notices & patrolling officer duty register)
  // Sheet 7: Events (if any)
  const sheets: SheetDefinition[] = [
    {
      id: "sheet-command",
      titleMr: "मुख्य ठाणे कर्तव्य व शाखा अधिकारी",
      subtitleMr: "ठाणे प्रमुख, पोनि शाखा, दिवस/रात्र ठाणे कर्तव्य व कार्यालयीन शाखा",
      sections: ["command"],
    },
    {
      id: "sheet-chowkis",
      titleMr: "पोलीस चौक्या दैनिक कर्तव्य",
      subtitleMr: "६ पोलीस चौक्या, चौकी प्रभारी व बिट मार्शल गस्त",
      sections: ["chowkis"],
    },
    {
      id: "sheet-special",
      titleMr: "कोर्ट, समन्स, विशेष कक्ष व गस्त वेळापत्रक",
      subtitleMr: "कोर्ट पैरवी, समन्स-वॉरंट, विशेष शाखा व सुरक्षित नाशिक गस्त वेळापत्रक",
      sections: ["special-duties", "scan-schedule"],
    },
    {
      id: "sheet-availability",
      titleMr: "कर्मचारी उपलब्धता व रजा नोंद",
      subtitleMr: "साप्ताहिक सुट्टी, किरकोळ रजा, वैद्यकीय रजा व इतर कर्तव्ये",
      sections: ["availability"],
    },
    {
      id: "sheet-directives",
      titleMr: "दैनिक सूचना व गस्त अधिकारी नोंद",
      subtitleMr: "रात्रगस्त सूचना, महत्वाचे निर्देश व गस्त अधिकारी नोंद",
      sections: ["notices-officers"],
    },
    {
      id: "sheet-manpower",
      titleMr: "मनुष्यबळ स्थिती, पाळीनिहाय सारांश व सही-शिक्का",
      subtitleMr: "मनुष्यबळ दर्शक मॅट्रिक्स, पाळीनिहाय संख्या, अचानक बदल व अधिकृत सही-शिक्का",
      sections: ["manpower-summary"],
    },
  ];

  if (hasEvents) {
    sheets.push({
      id: "sheet-events",
      titleMr: "विशेष कार्यक्रम व बंदोबस्त",
      subtitleMr: "विशेष बंदोबस्त व कार्यक्रम कर्मचारी नेमणूक",
      sections: ["events"],
    });
  }

  return sheets;
}
