/**
 * Purpose: Measure the intrinsic width of a rendered management-table column.
 * Current role: Autofit uses the browser's font, cell padding, badges, and action layout.
 * Last meaningful change: 2026-10-18 — DOM-based column autofit.
 * Constraint: The hidden clone is temporary and never changes the live table or its controls.
 */
export function measureManagementColumn(table: HTMLTableElement, columnIndex: number): number | undefined {
  const parent = table.parentElement;
  const view = table.ownerDocument.defaultView;
  if (!parent || !view) return undefined;

  // Keep the table's classes and ancestor context so CSS, inherited fonts, and
  // child controls are measured exactly as rendered, without fixed column widths.
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  Object.assign(clone.style, {
    position: "fixed",
    inset: "0 auto auto 0",
    visibility: "hidden",
    pointerEvents: "none",
    tableLayout: "auto",
    width: "max-content",
    minWidth: "0",
    maxWidth: "none",
  });
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll("colgroup, .management-column-resizer").forEach((element) => element.remove());

  Array.from(clone.rows).forEach((row, rowIndex) => {
    Array.from(row.cells).forEach((cell, cellIndex) => {
      const original = table.rows[rowIndex]?.cells[cellIndex];
      // Preserve explicit newlines, but remove width-induced text wrapping.
      const whiteSpace = original && view.getComputedStyle(original).whiteSpace;
      Object.assign(cell.style, {
        width: "auto",
        minWidth: "0",
        maxWidth: "none",
        whiteSpace: whiteSpace?.startsWith("pre") ? "pre" : "nowrap",
        overflowWrap: "normal",
        wordBreak: "normal",
      });
      // A wrapped flex action group must contribute all buttons, gaps, and
      // padding to its intrinsic width, not just the widest individual button.
      const originalChildren = original?.querySelectorAll<HTMLElement>("*");
      cell.querySelectorAll<HTMLElement>("*").forEach((element, index) => {
        const source = originalChildren?.[index];
        const display = source && view.getComputedStyle(source).display;
        if (display === "flex" || display === "inline-flex") {
          element.style.flexWrap = "nowrap";
          element.style.width = "max-content";
        }
      });
    });
  });
  clone.querySelectorAll(".management-table-empty").forEach((cell) => cell.parentElement?.remove());

  try {
    parent.appendChild(clone);
    const cells = Array.from(clone.rows)
      // The no-results message spans the entire table, not one column.
      .map((row) => row.cells[columnIndex])
      .filter((cell): cell is HTMLTableCellElement => Boolean(cell) && cell.colSpan === 1);
    const width = Math.max(0, ...cells.map((cell) => cell.getBoundingClientRect().width));
    // One pixel of rounding room prevents the final glyph falling onto a new line.
    return width > 0 ? Math.ceil(width) + 1 : undefined;
  } finally {
    clone.remove();
  }
}
