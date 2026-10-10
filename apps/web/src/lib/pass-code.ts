export type PassCode = {
  attemptId: string;
  nonce: string;
};

export function encodePass(attemptId: string, nonce: string): string {
  return JSON.stringify({ attempt_id: attemptId, nonce });
}

export function decodePass(raw: string): PassCode | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.attempt_id === "string" && typeof record.nonce === "string") {
        return { attemptId: record.attempt_id.trim(), nonce: record.nonce.trim() };
      }
    }
  } catch {
    // Не JSON — ниже разберём URL или пару через пробел.
  }

  try {
    const url = new URL(text);
    const attemptId = url.searchParams.get("attempt_id")?.trim();
    const nonce = url.searchParams.get("nonce")?.trim();
    if (attemptId && nonce) return { attemptId, nonce };
  } catch {
    // Не ссылка.
  }

  const parts = text.split(/[\s|]+/).filter(Boolean);
  if (parts.length === 2) return { attemptId: parts[0], nonce: parts[1] };
  return null;
}
