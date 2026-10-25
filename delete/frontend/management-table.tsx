"use client";

/**
 * Purpose: Shared, low-overhead table treatment for management and history views.
 * Current role: Left-aligned native tables with hidden status columns, persistent internal resizing and autofit.
 * Last meaningful change: 2026-10-18 — hide active-state columns and remove the trailing resizer handle.
 * Constraint: This is presentation-only; row actions and API mutations remain owned by each page.
 */
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/ui/cn";
import { measureManagementColumn } from "@/lib/management-table-sizing";
import { useLocale } from "@/lib/i18n";
import styles from "./management-table.module.css";

export type ManagementTableColumn<Row> = {
  id: string;
  label: string;
  /** Default width in pixels; bounds and autofit remain independently adjustable. */
  width?: number;
  /** Smallest allowed drag/keyboard/autofit width in pixels. */
  minWidth?: number;
  maxWidth?: number;
  headerClassName?: string;
  cellClassName?: string;
  render: (row: Row, rowIndex: number) => ReactNode;
};

type ManagementTableProps<Row> = {
  storageKey: string;
  columns: ManagementTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  rowClassName?: (row: Row) => string | undefined;
  toolbar?: ReactNode;
  actions?: ReactNode;
  countLabel?: ReactNode;
  emptyMessage: string;
  ariaLabel: string;
  showSerialNumber?: boolean;
  /** Active/inactive state remains available through rowClassName and filters, not a table column. */
  hideStatusColumn?: boolean;
};

type StoredTablePreferences = {
  version?: number;
  widths?: Record<string, number>;
};

type ResizeSession = {
  columnId: string;
  pointerId: number;
  startX: number;
  startWidth: number;
};

const DEFAULT_COLUMN_WIDTH = 140;
const DEFAULT_MIN_WIDTH = 80;
const DEFAULT_MAX_WIDTH = 420;
const TABLE_PREFERENCES_VERSION = 2;

function hasContent(content: ReactNode): boolean {
  return Children.toArray(content).some((child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return hasContent(child.props.children);
    return typeof child !== "string" || child.trim().length > 0;
  });
}

function widthBounds<Row>(column: ManagementTableColumn<Row>) {
  const min = Math.max(1, column.minWidth ?? DEFAULT_MIN_WIDTH);
  const max = Math.max(min, column.maxWidth ?? DEFAULT_MAX_WIDTH);
  return { min, max };
}

function clampWidth<Row>(value: number, column: ManagementTableColumn<Row>): number {
  const { min, max } = widthBounds(column);
  return Math.min(max, Math.max(min, value));
}

export function ManagementTable<Row>({
  storageKey,
  columns,
  rows,
  rowKey,
  rowClassName,
  toolbar,
  actions,
  countLabel,
  emptyMessage,
  ariaLabel,
  showSerialNumber = true,
  hideStatusColumn = true,
}: ManagementTableProps<Row>) {
  const { locale } = useLocale();
  const copy = locale === "mr" ? {
    serial: "अ. क्र.",
    resize: (label: string) => `${label}: स्तंभाची रुंदी बदला`,
    pixels: (width: number) => `${width} पिक्सेल`,
    resizeHint: "रुंदी बदलण्यासाठी ओढा. मजकुरानुसार रुंदी करण्यासाठी दोनदा क्लिक करा किंवा Enter दाबा. बाणांनी रुंदी बदला; Home/End ने किमान/कमाल रुंदी करा.",
  } : {
    serial: "Sr. No",
    resize: (label: string) => `Resize ${label} column`,
    pixels: (width: number) => `${width} pixels`,
    resizeHint: "Drag to resize; double-click or press Enter to autofit. Arrow keys resize; Home/End use the width bounds.",
  };
  const visibleColumns = hideStatusColumn ? columns.filter((column) => column.id !== "status") : columns;
  const tableColumns: ManagementTableColumn<Row>[] = [
    ...(showSerialNumber ? [{
      id: "__serial",
      label: copy.serial,
      width: 64,
      minWidth: 64,
      maxWidth: 120,
      headerClassName: styles.serial,
      cellClassName: styles.serial,
      render: (_row: Row, rowIndex: number) => rowIndex + 1,
    }] : []),
    ...visibleColumns,
  ];
  const columnSignature = tableColumns
    .map((column) => `${column.id}:${column.width ?? ""}:${column.minWidth ?? ""}:${column.maxWidth ?? ""}`)
    .join("|");
  const defaultWidths = useMemo<Record<string, number>>(
    () => Object.fromEntries(tableColumns.map((column) => [column.id, clampWidth(column.width ?? column.minWidth ?? DEFAULT_COLUMN_WIDTH, column)])),
    [columnSignature], // The signature keeps inline column definitions stable without requiring page-level memoization.
  );
  const [widths, setWidths] = useState<Record<string, number>>(defaultWidths);
  const [loadedPreferencesKey, setLoadedPreferencesKey] = useState<string | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const tableId = `${storageKey}-table`;
  const preferencesKey = `${storageKey}:${columnSignature}`;
  const hasToolbarMain = hasContent(toolbar) || hasContent(countLabel);
  const hasActions = hasContent(actions);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as StoredTablePreferences : undefined;
      // Keep the existing compact-width schema, including the user's drag sizes.
      const storedWidths = parsed?.version === TABLE_PREFERENCES_VERSION ? parsed.widths ?? {} : {};
      setWidths(Object.fromEntries(tableColumns.map((column) => [
        column.id,
        typeof storedWidths[column.id] === "number" && Number.isFinite(storedWidths[column.id])
          ? clampWidth(storedWidths[column.id], column)
          : defaultWidths[column.id],
      ])));
    } catch {
      setWidths(defaultWidths);
    } finally {
      setLoadedPreferencesKey(preferencesKey);
    }
  }, [defaultWidths, storageKey, columnSignature, preferencesKey]);

  useEffect(() => {
    if (loadedPreferencesKey !== preferencesKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: TABLE_PREFERENCES_VERSION, widths } satisfies StoredTablePreferences));
    } catch {
      // A full or restricted localStorage should not make the table unusable.
    }
  }, [loadedPreferencesKey, preferencesKey, storageKey, widths]);

  const setColumnWidth = (column: ManagementTableColumn<Row>, value: number) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setWidths((current) => ({
      ...current,
      [column.id]: clampWidth(next, column),
    }));
  };

  const widthFor = (column: ManagementTableColumn<Row>) =>
    clampWidth(widths[column.id] ?? column.width ?? column.minWidth ?? DEFAULT_COLUMN_WIDTH, column);

  const autofitColumn = async (column: ManagementTableColumn<Row>) => {
    // A webfont that is still loading must not leave us with fallback-font sizes.
    await document.fonts.ready;
    const table = tableRef.current;
    const columnIndex = tableColumns.findIndex((candidate) => candidate.id === column.id);
    if (!table || columnIndex < 0) return;
    const measured = measureManagementColumn(table, columnIndex);
    if (measured !== undefined) setColumnWidth(column, measured);
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, column: ManagementTableColumn<Row>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      columnId: column.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthFor(column),
    };
    setResizingColumn(column.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const column = tableColumns.find((candidate) => candidate.id === resize.columnId);
    if (!column) return;
    event.preventDefault();
    setColumnWidth(column, resize.startWidth + event.clientX - resize.startX);
  };

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    setResizingColumn(null);
  };

  const adjustWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: ManagementTableColumn<Row>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void autofitColumn(column);
      return;
    }
    const current = widthFor(column);
    const { min, max } = widthBounds(column);
    const step = event.shiftKey ? 20 : 8;
    const next = event.key === "Home"
      ? min
      : event.key === "End"
        ? max
        : event.key === "ArrowRight"
          ? current + step
          : event.key === "ArrowLeft"
            ? current - step
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setColumnWidth(column, next);
  };

  return (
    <section className={cn(styles.surface, resizingColumn && styles.resizing)}>
      {(hasToolbarMain || hasActions) && <div className={styles.toolbar}>
        {hasToolbarMain && <div className={styles.toolbarMain}>
          {toolbar}
          {hasContent(countLabel) && <span className={styles.count}>{countLabel}</span>}
        </div>}
        {hasActions && <div className={styles.toolbarActions}>
          {actions}
        </div>}
      </div>}

      <div className={styles.wrap}>
        <table ref={tableRef} id={tableId} className={cn(styles.table, resizingColumn && styles.resizing)} aria-label={ariaLabel} style={{ width: tableColumns.reduce((total, column) => total + widthFor(column), 0) }}>
          <colgroup>
            {tableColumns.map((column) => <col key={column.id} style={{ width: `${widthFor(column)}px` }} />)}
          </colgroup>
          <thead>
            <tr>
              {tableColumns.map((column, columnIndex) => {
                const { min, max } = widthBounds(column);
                const value = widthFor(column);
                return (
                  <th className={column.headerClassName} key={column.id} scope="col">
                    <span>{column.label}</span>
                    {columnIndex < tableColumns.length - 1 && <button
                        type="button"
                        role="separator"
                        className={cn("management-column-resizer", styles.resizer, resizingColumn === column.id && styles.activeResizer)}
                        aria-label={copy.resize(column.label)}
                        aria-controls={tableId}
                        aria-orientation="vertical"
                        aria-valuemin={min}
                        aria-valuemax={max}
                        aria-valuenow={value}
                        aria-valuetext={copy.pixels(value)}
                        onPointerDown={(event) => beginResize(event, column)}
                        onPointerMove={moveResize}
                        onPointerUp={finishResize}
                        onPointerCancel={finishResize}
                        onDoubleClick={() => void autofitColumn(column)}
                        onKeyDown={(event) => adjustWithKeyboard(event, column)}
                        title={copy.resizeHint}
                      />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr className={rowClassName?.(row)} key={rowKey(row)}>
                {tableColumns.map((column) => <td className={column.cellClassName} key={column.id}>{column.render(row, rowIndex)}</td>)}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className={cn("management-table-empty", styles.empty)} colSpan={tableColumns.length}>{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
