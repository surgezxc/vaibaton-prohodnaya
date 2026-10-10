import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, AuthUser } from "./types.js";
import { denyJson } from "./http.js";

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(url: string) {
  let set = jwksByUrl.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, set);
  }
  return set;
}

function rolesFrom(payload: JWTPayload): string[] {
  const roles = new Set<string>();
  const realm = payload.realm_access;
  if (realm && typeof realm === "object" && "roles" in realm && Array.isArray(realm.roles)) {
    for (const role of realm.roles) {
      if (typeof role === "string") roles.add(role);
    }
  }
  if (Array.isArray(payload.roles)) {
    for (const role of payload.roles) {
      if (typeof role === "string") roles.add(role);
    }
  }
  return [...roles];
}

// Личность — только claim `sub`. Тело запроса сюда не передаётся.
export async function authenticate(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  const hmac = process.env.JWT_HMAC_SECRET?.trim();

  try {
    let payload: JWTPayload;
    if (issuer) {
      const jwksUrl =
        process.env.KEYCLOAK_JWKS_URL?.trim() ||
        `${issuer.replace(/\/$/, "")}/protocol/openid-connect/certs`;
      const verified = await jwtVerify(token, jwksFor(jwksUrl), { issuer });
      payload = verified.payload;
    } else if (hmac) {
      const verified = await jwtVerify(token, new TextEncoder().encode(hmac), {
        algorithms: ["HS256"],
      });
      payload = verified.payload;
    } else {
      return null;
    }
    if (!payload.sub) return null;
    return { sub: payload.sub, roles: rolesFrom(payload) };
  } catch {
    return null;
  }
}

export function requireRoles(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(c.req.header("authorization"));
    if (!user) {
      return denyJson(c, 401, "Нужен вход через Keycloak.");
    }
    if (!roles.some((role) => user.roles.includes(role))) {
      return denyJson(c, 403, "Недостаточно прав для этого действия.");
    }
    c.set("user", user);
    await next();
  };
}
