// Образ compose собирается с NEXT_PUBLIC_USE_PAGE_ORIGIN=1.
// Тогда и ноутбук, и телефон ходят в API и Keycloak на тот же https://<LAN>:8443.
function pageOrigin(): string | null {
  if (process.env.NEXT_PUBLIC_USE_PAGE_ORIGIN !== "1") return null;
  if (typeof window === "undefined") return null;
  if (window.location.protocol !== "https:") return null;
  return window.location.origin;
}

export function apiBase(): string {
  return (pageOrigin() ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

export function keycloakBase(): string {
  return (pageOrigin() ?? process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8081").replace(/\/$/, "");
}
