import { requireRoles } from "../auth.js";
import { denyJson } from "../http.js";
import type { ApiApp } from "../types.js";

type KcUser = {
  id?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

function adminBase(): string {
  return (process.env.KEYCLOAK_ADMIN_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
}

async function adminToken(): Promise<string> {
  const username = process.env.KEYCLOAK_ADMIN || "admin";
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD || "";
  if (!password) throw new Error("no-admin-password");
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username,
    password,
  });
  const response = await fetch(`${adminBase()}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("admin-auth");
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("admin-auth");
  return json.access_token;
}

export function registerDirectory(app: ApiApp): void {
  app.get("/directory/worker", requireRoles("admin"), async (c) => {
    try {
      const token = await adminToken();
      const url = new URL(`${adminBase()}/admin/realms/prohodnaya/users`);
      url.searchParams.set("username", "worker");
      url.searchParams.set("exact", "true");
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return denyJson(c, 503, "Не удалось прочитать учётку worker в Keycloak.");
      const users = (await response.json()) as KcUser[];
      const user = Array.isArray(users) ? users.find((item) => item.username === "worker" && item.id) : undefined;
      if (!user?.id) return denyJson(c, 404, "Учётка worker в Keycloak не найдена.");
      const fullName = [user.lastName, user.firstName].filter(Boolean).join(" ").trim();
      return c.json({
        username: "worker",
        keycloak_sub: user.id,
        full_name: fullName || "worker",
      });
    } catch {
      return denyJson(c, 503, "Keycloak недоступен. Учётку worker прочитать не удалось.");
    }
  });
}
