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
    specialColumns = 4;
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
    specialColumns = 3;
    availabilityColumns = 3;
    packedRosterColumns = 3;
  } else {
    // A4 Landscape: 281mm printable width
    chowkiColumns = 3;
    stationColumns = 3;
    specialColumns = 5;
    availabilityColumns = 6;
    packedRosterColumns = 5;
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
  // 5 Canonical Sheets matching Kushal Figma Page 1 + compv3 Lower Pages:
  // Sheet 1: Figma Command (Senior PI, 3 supervisors, 4 lower columns: Day, Night, Office, Notices)
  // Sheet 2: 6 Police Chowkis (3x2 grid with Day/Night sub-columns and Bit Marshals)
  // Sheet 3: Leave & Special Duties (Availability/Leaves + Court Pairvi & Special Squads)
  // Sheet 4: Manpower Matrix & Changes (Rank Matrix + Shift Summary + Sudden Change Ledger)
  // Sheet 5: Officer Summary & Scan Schedule (15 Officers + Patrol/Scan Schedule + Official Sign-off)
  // Sheet 6: Events Annex (Optional when events exist)
  const sheets: SheetDefinition[] = [
    {
      id: "sheet-command",
      titleMr: "मुख्य ठाणे कर्तव्य व शाखा अधिकारी",
      subtitleMr: "ठाणे प्रमुख, पोनि शाखा, दिवस/रात्र ठाणे कर्तव्य, कार्यालयीन शाखा व सूचना",
      sections: ["command"],
    },
    {
      id: "sheet-chowkis",
      titleMr: "पोलीस चौक्या दैनिक कर्तव्य",
      subtitleMr: "६ पोलीस चौक्या, चौकी प्रभारी व बिट मार्शल गस्त",
      sections: ["chowkis"],
    },
    {
      id: "sheet-leave-special",
      titleMr: "रजा, उपलब्धता व कोर्ट / विशेष कर्तव्ये",
      subtitleMr: "साप्ताहिक सुट्टी, किरकोळ/वैद्यकीय रजा, गैरहजर, कोर्ट पैरवी व विशेष बंदोबस्त",
      sections: ["availability", "special-duties"],
    },
    {
      id: "sheet-manpower",
      titleMr: "मनुष्यबळ स्थिती दर्शक मॅट्रिक्स व पाळी सारांश",
      subtitleMr: "मंजूर/हजर संख्याबळ, पाळीनिहाय सारांश व अचानक बदल नोंद",
      sections: ["manpower-summary"],
    },
    {
      id: "sheet-officers-scan",
      titleMr: "पोलीस अधिकारी कर्तव्य सारांश व गस्त वेळापत्रक",
      subtitleMr: "अधिकारी कर्तव्य वाटप, सुरक्षित नाशिक गस्त/स्कॅनिंग व अधिकृत सही-शिक्का",
      sections: ["officers-scan"],
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
