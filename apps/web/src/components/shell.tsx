import Link from "next/link";
import type { ReactNode } from "react";
import type { Session } from "@/lib/session";

const links = [
  ["/gate", "Контролёр"],
  ["/phone", "Рабочий"],
  ["/admin", "Кадры"],
  ["/manager", "Руководитель"],
] as const;

export function Shell({
  current,
  session,
  onLogout,
  children,
}: {
  current?: string;
  session?: Session | null;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-5 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold no-underline">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-900 text-white">П</span>
          Проходная
        </Link>
        <nav className="flex flex-wrap gap-1" aria-label="Экраны">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={current === href ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm no-underline ${
                current === href ? "bg-emerald-100 font-semibold text-emerald-950" : "text-stone-700"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {session ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-600">
          <span>
            Вход: <strong className="font-semibold text-stone-800">{session.username || session.sub}</strong>
          </span>
          {onLogout ? (
            <button type="button" className="min-h-11 underline" onClick={onLogout}>
              Выйти
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "wait" | "ok" | "bad";
  title: string;
  children?: ReactNode;
}) {
  const toneClass = {
    neutral: "border-stone-200 bg-stone-50",
    wait: "border-amber-200 bg-amber-50",
    ok: "border-emerald-300 bg-emerald-50",
    bad: "border-red-200 bg-red-50",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`} role="status" aria-live="polite">
      <strong className="block">{title}</strong>
      {children ? <div className="mt-1 text-sm text-stone-700">{children}</div> : null}
    </div>
  );
}

export function RoleWarning({ session, role, label }: { session: Session; role: string; label: string }) {
  if (session.roles.includes(role)) return null;
  return (
    <Notice tone="wait" title="Роль не совпадает с экраном">
      Учётка {session.username || "без имени"} без роли «{label}». Сервер ответит отказ.
    </Notice>
  );
}
