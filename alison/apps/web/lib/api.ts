export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch("/api/proxy/" + path.replace(/^\/+/, ""), {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Не удалось связаться с сервером. Проверьте, что стенд запущен.", 0);
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = String(body.reason_human || body.message || body.error || "Сервер пока не готов. Попробуйте позже.");
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function queryString(values: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value) params.set(key, value);
  }
  const result = params.toString();
  return result ? "?" + result : "";
}
