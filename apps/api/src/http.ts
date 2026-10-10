import type { Context } from "hono";
import type { AppEnv, ReasonCode } from "./types.js";

export function russian(reason: string, extra: Record<string, unknown> = {}) {
  return {
    reason,
    reason_human: reason,
    ...extra,
  };
}

export function denyJson(c: Context<AppEnv>, status: 400 | 401 | 403 | 404 | 409 | 422 | 503, reason: string) {
  return c.json(russian(reason), status);
}

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function decisionBody(
  decision: "allow" | "deny",
  reason: string,
  reasonCode: ReasonCode | null,
  shift?: { shift_id: string; started_at: string; ended_at: string | null },
) {
  return {
    decision,
    reason,
    reason_human: reason,
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    ...(shift ? { shift } : {}),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
