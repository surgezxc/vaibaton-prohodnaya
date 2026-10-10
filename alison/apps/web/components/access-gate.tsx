"use client";

import { useAuth } from "./auth-provider";

export function AccessGate({ role, children }: { role: "admin" | "manager"; children: React.ReactNode }) {
  const auth = useAuth();

  if (!auth.ready) {
    return <main className="auth-screen"><div className="auth-card"><span className="loader" /><p>Проверяем вход…</p></div></main>;
  }

  if (!auth.configured) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark">П</div><h1>Вход не настроен</h1><p>Укажите адрес Keycloak, realm и client ID в файле .env.</p><p className="muted">Роль <b>{role}</b> проверяется по токену Keycloak.</p></div></main>;
  }

  if (!auth.authenticated) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark">П</div><h1>Проходная</h1><p>Войдите через Keycloak, чтобы открыть рабочее место.</p>{auth.error && <p className="inline-error">{auth.error}</p>}<button className="button button-primary" onClick={auth.login}>Войти через Keycloak</button></div></main>;
  }

  if (!auth.roles.includes(role)) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark">П</div><h1>Нет доступа</h1><p>Для этого экрана нужна роль <b>{role}</b>.</p><button className="button button-secondary" onClick={auth.logout}>Выйти</button></div></main>;
  }

  return <>{children}</>;
}
