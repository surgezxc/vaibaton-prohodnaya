import { apiBase } from "./config";

export type ApiResult = {
  status: number;
  json: Record<string, unknown> | null;
  offline: boolean;
};

export const offlineReason = "Не удалось связаться с API. Запрос не выполнен.";

export function serverReason(json: Record<string, unknown> | null, fallback: string): string {
  if (typeof json?.reason_human === "string" && json.reason_human.trim()) return json.reason_human;
  if (typeof json?.reason === "string" && json.reason.trim()) return json.reason;
  return fallback;
}

export async function apiRequest(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<ApiResult> {
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await readObject(response), offline: false };
  } catch {
    return { status: 0, json: null, offline: true };
  }
}

async function readObject(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function asArray<T>(json: Record<string, unknown> | null, key: string): T[] {
  const value = json?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}
