import Link from "next/link";
import { Account } from "./auth-provider";
import type { ReactNode } from "react";

type Props = {
  role: "gate" | "phone";
  title: string;
  description: string;
  children: ReactNode;
};

export function ScreenShell({ role, title, description, children }: Props) {
  return (
    <main className={`screen ${role === "phone" ? "screen-phone" : ""}`}>
      <header className="masthead">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">П</span>Проходная</Link>
        <nav aria-label="Выбор экрана">
          <Link href="/gate" aria-current={role === "gate" ? "page" : undefined}>Контролёр</Link>
          <Link href="/phone" aria-current={role === "phone" ? "page" : undefined}>Рабочий</Link>
        </nav>
      </header>
      <aside className="demo-banner">
        <strong>Стенд разработки</strong>
        <span>Проход и смену подтверждает сервер. Геолокация работает при открытой смене и видимой странице.</span>
      </aside>
      <div className="page-heading"><p className="eyebrow">{role === "gate" ? "Планшет проходной" : "Телефон рабочего"}</p><h1>{title}</h1><p>{description}</p></div>
      <Account role={role === "gate" ? "gate" : "worker"} />
      {children}
      <footer className="footer">Решение о проходе принимает сервер. При ошибке связи результат может быть неизвестен.</footer>
    </main>
  );
}

export function Status({ title, children, tone = "neutral" }: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "waiting" | "error";
}) {
  return <div className={`status status-${tone}`} role="status" aria-live="polite" aria-atomic="true"><strong>{title}</strong><p>{children}</p></div>;
}
