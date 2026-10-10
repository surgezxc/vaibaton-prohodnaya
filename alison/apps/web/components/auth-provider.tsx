"use client";

import Keycloak from "keycloak-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type AuthState = {
  ready: boolean;
  configured: boolean;
  authenticated: boolean;
  token: string;
  username: string;
  roles: string[];
  error: string;
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);
function makeKeycloak(options: ConstructorParameters<typeof Keycloak>[0]) {
  return new Keycloak(options);
}
type KeycloakClient = ReturnType<typeof makeKeycloak>;
let browserClient: KeycloakClient | null = null;
let browserInit: Promise<boolean> | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<KeycloakClient | null>(null);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState("");

  const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
  const configured = Boolean(url && realm && clientId);

  useEffect(() => {
    if (!configured || !url || !realm || !clientId) {
      setReady(true);
      return;
    }
    let mounted = true;
    const instance = browserClient || (browserClient = new Keycloak({ url, realm, clientId }));
    setClient(instance);
    browserInit = browserInit || instance.init({ onLoad: "check-sso", pkceMethod: "S256", checkLoginIframe: false });
    browserInit
      .then(async (authenticatedNow) => {
        if (!mounted) return;
        setAuthenticated(authenticatedNow);
        if (authenticatedNow) {
          setToken(instance.token || "");
          const claims = instance.tokenParsed as { realm_access?: { roles?: string[] }; preferred_username?: string } | undefined;
          setRoles(claims?.realm_access?.roles || []);
          setUsername(claims?.preferred_username || "");
          try {
            const user = await instance.loadUserProfile();
            if (mounted) setUsername(user.username || claims?.preferred_username || "");
          } catch {
            if (mounted) setUsername(claims?.preferred_username || "");
          }
        }
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) {
          setError("Не удалось проверить вход в Keycloak.");
          setReady(true);
        }
      });
    return () => { mounted = false; };
  }, [configured, url, realm, clientId]);

  useEffect(() => {
    if (!client || !authenticated) return;
    const timer = window.setInterval(() => {
      client.updateToken(45)
        .then(() => setToken(client.token || ""))
        .catch(() => {
          setAuthenticated(false);
          setToken("");
        });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [client, authenticated]);

  const value = useMemo<AuthState>(() => ({
    ready,
    configured,
    authenticated,
    token,
    username: username || "Пользователь",
    roles,
    error,
    login: () => { if (client) void client.login({ redirectUri: window.location.href }); },
    logout: () => { if (client) void client.logout({ redirectUri: window.location.origin + "/admin" }); },
  }), [ready, configured, authenticated, token, username, roles, error, client]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
