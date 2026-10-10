export type Attempt = { attempt_id: string; nonce: string; expires_at: string; direction: "in" | "out" };
export type Decision = { decision: "allow" | "deny"; reason_human?: string; reason: string; reason_code?: string };

export async function apiRequest<T>(path: string, token: string, body?: unknown, keepalive = false): Promise<T> {
  const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
      keepalive,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.reason_human || result?.reason || `Ошибка сервера (${response.status}).`);
    if (!result) throw new Error("Сервер вернул некорректный ответ.");
    return result as T;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Нет связи с сервером. Проверьте сеть и адрес API.");
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Сервер не ответил вовремя. Результат неизвестен; не повторяйте проход вслепую.");
    throw error;
  } finally { clearTimeout(timer); }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие.";
}
