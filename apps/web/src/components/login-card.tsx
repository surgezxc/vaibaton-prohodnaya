"use client";

import { FormEvent, useState } from "react";
import { passwordGrant, type Session } from "@/lib/session";

export function LoginCard({
  username,
  onSuccess,
}: {
  username: string;
  onSuccess: (session: Session) => void;
}) {
  const [name, setName] = useState(username);
  const [password, setPassword] = useState("dev-only");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await passwordGrant(name, password);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess(result.session);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Вход</h2>
      <p className="mt-1 text-sm text-stone-600">
        Keycloak, realm prohodnaya, клиент web. Пароль учёток стенда — dev-only.
      </p>
      <label className="mt-4 block text-sm font-medium">
        Логин
        <input
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3"
          autoComplete="username"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="mt-3 block text-sm font-medium">
        Пароль
        <input
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="mt-4 min-h-12 w-full rounded-xl bg-emerald-900 px-4 font-semibold text-white"
        type="submit"
        disabled={pending}
      >
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
