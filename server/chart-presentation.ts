// Purpose: Safe, typed per-element chart presentation controls and resolution.
// Current role: Shared renderer/API contract for presentation_overrides.elements.
// Last meaningful change: 2026-10-13 — alignment, visibility and compact controls.
// Constraint: Only enumerated values/booleans; no HTML, CSS, JS or source-data edits.
import type { ChartDocument } from "./chart-document.js";

export interface ElementPresentation {
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  hidden?: boolean;
  compact?: boolean;
}

export interface PresentationPatch {
  key: string;
  horizontalAlign?: ElementPresentation["horizontalAlign"] | null;
  verticalAlign?: ElementPresentation["verticalAlign"] | null;
  hidden?: boolean | null;
  compact?: boolean | null;
}

export interface PresentationElement {
  key: string;
  label: string;
  kind: "label" | "section" | "support";
  empty?: boolean;
}

export class PresentationError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409) {
    super(message);
    this.name = "PresentationError";
  }
}

const FIELDS = ["horizontalAlign", "verticalAlign", "hidden", "compact"] as const;
const HORIZONTAL = ["left", "center", "right"];
const VERTICAL = ["top", "middle", "bottom"];
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Strict PATCH input. null clears ONE property; omitted properties remain untouched. */
export function validatePresentationPatch(input: unknown): PresentationPatch {
  if (!record(input)) throw new PresentationError("presentation body must be an object", 400);
  if (Object.keys(input).some((key) => key !== "key" && !FIELDS.includes(key as typeof FIELDS[number]))) {
    throw new PresentationError("only key, horizontalAlign, verticalAlign, hidden and compact are editable", 400);
  }
  if (typeof input.key !== "string" || input.key.trim() !== input.key || input.key.length === 0
    || input.key.length > 240 || /[<>\u0000-\u001f\u007f]/.test(input.key)
    || input.key.split(".").some((part) => DANGEROUS_KEYS.has(part))) {
    throw new PresentationError("key must be a valid chart element key (max 240 characters)", 400);
  }
  if (!FIELDS.some((field) => Object.hasOwn(input, field))) {
    throw new PresentationError("at least one presentation property is required", 400);
  }
  for (const field of FIELDS) {
    if (!Object.hasOwn(input, field) || input[field] === null) continue;
    const value = input[field];
    const valid = field === "horizontalAlign" ? HORIZONTAL.includes(value as string)
      : field === "verticalAlign" ? VERTICAL.includes(value as string)
        : typeof value === "boolean";
    if (!valid) throw new PresentationError(`invalid ${field}`, 400);
  }
  return input as unknown as PresentationPatch;
}

/** Read only allowed fields even from old/manual JSON. Untrusted style strings never render. */
function safePresentation(value: unknown): ElementPresentation {
  if (!record(value)) return {};
  const out: ElementPresentation = {};
  if (HORIZONTAL.includes(value.horizontalAlign as string)) {
    out.horizontalAlign = value.horizontalAlign as ElementPresentation["horizontalAlign"];
  }
  if (VERTICAL.includes(value.verticalAlign as string)) {
    out.verticalAlign = value.verticalAlign as ElementPresentation["verticalAlign"];
  }
  if (typeof value.hidden === "boolean") out.hidden = value.hidden;
  if (typeof value.compact === "boolean") out.compact = value.compact;
  return out;
}

function elementMap(value: unknown): Record<string, unknown> {
  return record(value) ? value : {};
}

/** Chart element properties override the pinned template's element properties field-by-field.
 * Missing properties keep existing CSS defaults; explicit false beats a template true. */
export function resolvePresentation(doc: ChartDocument, key: string): ElementPresentation {
  const base = elementMap(doc.template.layout.elements);
  const overrides = elementMap(doc.template.overrides.elements);
  return {
    ...safePresentation(Object.hasOwn(base, key) ? base[key] : undefined),
    ...safePresentation(Object.hasOwn(overrides, key) ? overrides[key] : undefined),
  };
}

/** Merge just one element without erasing labels, added boxes or other chart-local controls. */
export function mergePresentationPatch(
  overrides: Record<string, unknown>, patch: PresentationPatch,
): Record<string, unknown> {
  // Normalize the whole presentation map on every write. This prevents an old/manual JSON
  // value such as {css:"..."} from remaining in the presentation namespace; only these four
  // enumerated hooks are ever persisted by this route.
  const elements: Record<string, ElementPresentation> = {};
  for (const [key, value] of Object.entries(elementMap(overrides.elements))) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const safe = safePresentation(value);
    if (Object.keys(safe).length > 0) elements[key] = safe;
  }
  const element = safePresentation(Object.hasOwn(elements, patch.key) ? elements[patch.key] : undefined);
  for (const field of FIELDS) {
    if (!Object.hasOwn(patch, field)) continue;
    if (patch[field] === null) delete element[field];
    else Object.assign(element, { [field]: patch[field] });
  }
  if (Object.keys(element).length === 0) delete elements[patch.key];
  else elements[patch.key] = element;
  const merged = { ...overrides };
  if (Object.keys(elements).length === 0) delete merged.elements;
  else merged.elements = elements;
  return merged;
}
