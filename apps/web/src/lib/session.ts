import { keycloakBase } from "./config";

const KEY = "prohodnaya.session";

export type Session = {
  token: string;
  sub: string;
  username: string;
  roles: string[];
};

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as Partial<Session>;
    if (typeof session.token !== "string" || !session.token) return null;
    return {
      token: session.token,
      sub: typeof session.sub === "string" ? session.sub : "",
      username: typeof session.username === "string" ? session.username : "",
      roles: Array.isArray(session.roles) ? session.roles.filter((role) => typeof role === "string") : [],
    };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
}

function payloadOf(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(normalized));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rolesOf(payload: Record<string, unknown>): string[] {
  const realm = payload.realm_access;
  if (!realm || typeof realm !== "object" || !("roles" in realm)) return [];
  const roles = (realm as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === "string");
}

export function sessionFromToken(token: string): Session {
  const payload = payloadOf(token);
  return {
    token,
    sub: typeof payload.sub === "string" ? payload.sub : "",
    username: typeof payload.preferred_username === "string" ? payload.preferred_username : "",
    roles: rolesOf(payload),
  };
}

export async function passwordGrant(
  username: string,
  password: string,
): Promise<{ ok: true; session: Session } | { ok: false; message: string }> {
  try {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: "web",
      username: username.trim(),
      password,
    });
    const response = await fetch(`${keycloakBase()}/realms/prohodnaya/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed: unknown = await response.json().catch(() => null);
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const token = record && typeof record.access_token === "string" ? record.access_token : null;
    if (!response.ok || !token) {
      const description = record && typeof record.error_description === "string" ? record.error_description : "";
      return {
        ok: false,
        message: description ? `Вход не выполнен. ${description}` : "Вход не выполнен. Проверьте логин и пароль.",
      };
    }
    return { ok: true, session: sessionFromToken(token) };
  } catch {
    return { ok: false, message: "Keycloak недоступен. Проверьте, что стенд запущен." };
  }
}
