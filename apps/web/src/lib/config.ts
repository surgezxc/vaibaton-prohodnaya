// Образ compose собирается с NEXT_PUBLIC_USE_PAGE_ORIGIN=1.
// https://<LAN>:8443 и http://<LAN>:8080 ходят в API и Keycloak на тот же origin.
// localhost остаётся на NEXT_PUBLIC_API_URL и NEXT_PUBLIC_KEYCLOAK_URL.
function pageOrigin(): string | null {
  if (process.env.NEXT_PUBLIC_USE_PAGE_ORIGIN !== "1") return null;
  if (typeof window === "undefined") return null;
  const { protocol, port } = window.location;
  if (protocol === "https:") return window.location.origin;
  if (protocol === "http:" && port === "8080") return window.location.origin;
  return null;
}

export function apiBase(): string {
  return (pageOrigin() ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

export function keycloakBase(): string {
  return (pageOrigin() ?? process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8081").replace(/\/$/, "");
}
