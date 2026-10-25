/**
 * Purpose: Small browser client for the local Fastify REST API.
 * Current role: All frontend mutations go through narrow existing endpoints.
 * Last meaningful change: 2026-10-18 — initial Next.js frontend boundary.
 * Constraint: Never call a remote service; Next rewrites these relative paths to Fastify.
 */

import type { ApiErrorPayload } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const payload = await readPayload(response);
  if (!response.ok) throw new ApiError(response.status, (payload as ApiErrorPayload) || {});
  return payload as T;
}

export const apiPatch = <T>(input: string, body: unknown) =>
  apiFetch<T>(input, { method: "PATCH", body: JSON.stringify(body) });

export const apiPost = <T>(input: string, body: unknown = {}) =>
  apiFetch<T>(input, { method: "POST", body: JSON.stringify(body) });

export const apiPut = <T>(input: string, body: unknown = {}) =>
  apiFetch<T>(input, { method: "PUT", body: JSON.stringify(body) });

export const apiDelete = <T>(input: string) => apiFetch<T>(input, { method: "DELETE" });
