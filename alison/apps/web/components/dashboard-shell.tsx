"use client";

import Link from "next/link";
import { useAuth } from "./auth-provider";

export function DashboardShell({ active, children }: { active: "admin" | "manager"; children: React.ReactNode }) {
  const auth = useAuth();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/admin" className="brand"><span className="brand-mark">П</span><span><b>Проходная</b><small>стройплощадка · Северный</small></span></Link>
        <div className="side-caption">РАБОЧЕЕ МЕСТО</div>
        <nav className="side-nav">
          <Link className={active === "admin" ? "nav-item active" : "nav-item"} href="/admin"><span className="nav-icon">▦</span> Администрирование</Link>
          <Link className={active === "manager" ? "nav-item active" : "nav-item"} href="/manager"><span className="nav-icon">◫</span> Обстановка</Link>
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-status"><span className="status-dot" /> Стенд проекта</div><span>Контроль доступа и смен</span></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Рабочее место <span>/</span> {active === "admin" ? "Администрирование" : "Обстановка"}</div><div className="user-menu"><span className="avatar">{auth.username.slice(0, 1).toUpperCase()}</span><span className="user-name">{auth.username}</span><button className="logout-button" onClick={auth.logout}>Выйти</button></div></header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
