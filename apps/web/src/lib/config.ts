export function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

export function keycloakBase(): string {
  return (process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8081").replace(/\/$/, "");
}
