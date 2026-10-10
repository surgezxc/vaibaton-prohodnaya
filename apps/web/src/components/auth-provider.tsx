"use client";

import Keycloak from "keycloak-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { keycloakBase } from "@/lib/config";
import { ensurePkceDigest } from "@/lib/sha256-subtle.mjs";

let initialization: Promise<Keycloak> | undefined;
function initialize() {
  if (!initialization) initialization = (async () => {
    const url = keycloakBase();
    if (!url) throw new Error("Вход не настроен. Укажите адрес Keycloak в конфигурации приложения.");
    const client = new Keycloak({ url, realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "prohodnaya", clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "web" });
    const pkce = ensurePkceDigest();
    await client.init({ pkceMethod: pkce ? "S256" : false, checkLoginIframe: false, responseMode: "query" });
    return client;
  })();
  return initialization;
}

type Auth = {
  ready: boolean; authenticated: boolean; error: string | null;
  subject: string | null; name: string | null; roles: string[];
  login: () => Promise<void>; logout: () => Promise<void>; token: () => Promise<string>;
};
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<Keycloak | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => {
    let disposed = false;
    initialize().then((kc) => {
      if (disposed) return;
      setClient(kc); setAuthenticated(Boolean(kc.authenticated)); setReady(true);
      kc.onAuthLogout = () => { if (!disposed) setAuthenticated(false); };
    }).catch(() => {
      if (disposed) return;
      setError(process.env.NEXT_PUBLIC_KEYCLOAK_URL ? "Не удалось подключить вход. Проверьте доступ к Keycloak и разрешённый адрес возврата." : "Вход не настроен. Укажите адрес Keycloak в конфигурации приложения.");
      setReady(true);
    });
    return () => { disposed = true; };
  }, []);
  async function token() {
    if (!client?.authenticated) throw new Error("Войдите в систему перед действием.");
    try { await client.updateToken(30); }
    catch { client.clearToken(); setAuthenticated(false); throw new Error("Сессия завершилась. Войдите снова."); }
    if (!client.token) throw new Error("Сессия завершилась. Войдите снова.");
    return client.token;
  }
  const value: Auth = {
    ready, authenticated, error,
    subject: authenticated ? client?.tokenParsed?.sub || null : null,
    name: authenticated ? client?.tokenParsed?.preferred_username || null : null,
    roles: authenticated ? client?.realmAccess?.roles || [] : [],
    token,
    login: async () => {
      if (!client) throw new Error("Вход пока недоступен.");
      await client.login({ redirectUri: `${location.origin}${location.pathname}` });
    },
    logout: async () => {
      if (!client) return;
      sessionStorage.removeItem("prohodnaya-pending-qr");
      sessionStorage.removeItem("prohodnaya-confirmed-attempt");
      await client.logout({ redirectUri: location.origin });
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider не найден.");
  return value;
}

export function Account({ role }: { role: "gate" | "worker" }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const allowed = auth.roles.includes(role);
  return <section className="panel account-panel">
    <div className="section-heading"><h2>Учётная запись</h2><span className="badge">{auth.authenticated ? auth.name : "Вход не выполнен"}</span></div>
    {auth.error && <p role="alert" className="inline-error">{auth.error}</p>}
    {auth.authenticated && !allowed && <p role="alert" className="inline-error">Для этого экрана нужна роль {role === "gate" ? "контролёра" : "рабочего"}.</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="button button-secondary" disabled={!auth.ready || Boolean(auth.error)} onClick={() => {
      setError(null);
      (auth.authenticated ? auth.logout() : auth.login()).catch(() => setError("Не удалось выполнить вход или выход. Проверьте соединение."));
    }}>{!auth.ready ? "Подключение входа…" : auth.authenticated ? "Выйти" : "Войти через Keycloak"}</button>
  </section>;
}
