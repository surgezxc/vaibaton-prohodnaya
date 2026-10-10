"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginCard } from "@/components/login-card";
import { Panel, RoleWarning, Shell } from "@/components/shell";
import { useSession } from "@/components/use-session";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import { formatWhen } from "@/lib/format";

type Inside = {
  person_id: string;
  full_name: string;
  shift_id: string;
  started_at: string;
};

export default function ManagerPage() {
  const { session, login, logout } = useSession();
  return (
    <Shell current="/manager" session={session} onLogout={logout}>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Руководитель</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Кто на объекте</h1>
      <p className="mt-2 mb-5 max-w-2xl text-stone-600">Открытые смены: человек и время входа. Пустой список значит, что внутри никого.</p>
      {session ? (
        <>
          <RoleWarning session={session} role="manager" label="руководитель" />
          <NowBoard token={session.token} />
        </>
      ) : (
        <LoginCard username="manager" onSuccess={login} />
      )}
    </Shell>
  );
}

function NowBoard({ token }: { token: string }) {
  const [rows, setRows] = useState<Inside[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setPending(true);
    const response = await apiRequest("/site/now", "GET", token);
    setPending(false);
    if (response.offline) {
      setRows([]);
      setError(offlineReason);
      return;
    }
    if (response.status !== 200) {
      setRows([]);
      setError(serverReason(response.json, "Сводка не загрузилась."));
      return;
    }
    setError(null);
    setRows(asArray<Inside>(response.json, "inside"));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={rows ? `Сейчас внутри: ${rows.length}` : "Сейчас внутри"} aside={<button type="button" className="text-sm font-semibold text-emerald-900" onClick={() => void load()} disabled={pending}>{pending ? "Обновляем…" : "Обновить"}</button>}>
      {rows === null ? <p className="text-sm text-stone-600">Загружаем смены…</p> : null}
      {error ? (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {rows && rows.length === 0 && !error ? <p className="text-sm text-stone-600">На объекте никого. Открытых смен нет.</p> : null}
      <ul className="grid gap-3">
        {rows?.map((row) => (
          <li key={row.shift_id} className="rounded-xl border border-stone-200 px-4 py-3">
            <strong>{row.full_name}</strong>
            <p className="text-sm text-stone-600">на объекте с {formatWhen(row.started_at)}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
