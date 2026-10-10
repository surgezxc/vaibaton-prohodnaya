"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoginCard } from "@/components/login-card";
import { RoleWarning, Shell } from "@/components/shell";
import { useSession } from "@/components/use-session";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import { directionLabel, formatWhen } from "@/lib/format";

type Row = {
  id: string;
  at: string;
  full_name: string | null;
  what: string;
  direction: string | null;
  decision: string | null;
  reason: string | null;
  reason_human: string | null;
};

export default function JournalPage() {
  return (
    <Suspense fallback={<Shell current="/admin"><p className="text-sm text-stone-600">Загружаем журнал…</p></Shell>}>
      <JournalScreen />
    </Suspense>
  );
}

function JournalScreen() {
  const { session, login, logout } = useSession();
  const personId = useSearchParams().get("person_id");
  return (
    <Shell current="/admin" session={session} onLogout={logout}>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Кадры</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Журнал попыток</h1>
      <p className="mt-2 mb-5 text-stone-600">
        <Link href="/admin" className="font-semibold text-emerald-900">
          К списку людей
        </Link>
        {personId ? " · фильтр по одному человеку" : " · все записи"}
      </p>
      {session ? (
        <>
          <RoleWarning session={session} role="admin" label="администратор" />
          <JournalList token={session.token} personId={personId} />
        </>
      ) : (
        <LoginCard username="admin" onSuccess={login} />
      )}
    </Shell>
  );
}

function JournalList({ token, personId }: { token: string; personId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = personId ? `?person_id=${encodeURIComponent(personId)}&limit=100` : "?limit=100";
    const response = await apiRequest(`/journal${query}`, "GET", token);
    if (response.offline) {
      setRows([]);
      setError(offlineReason);
      return;
    }
    if (response.status !== 200) {
      setRows([]);
      setError(serverReason(response.json, "Журнал не загрузился."));
      return;
    }
    setError(null);
    setRows(asArray<Row>(response.json, "journal"));
  }, [personId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) return <p className="text-sm text-stone-600">Загружаем журнал…</p>;
  return (
    <div>
      {error ? (
        <p className="mb-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {rows.length === 0 && !error ? <p className="text-sm text-stone-600">Записей пока нет.</p> : null}
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">{formatWhen(row.at)}</p>
            <p className="font-semibold">
              {row.full_name || "без человека"} · {row.what} · {directionLabel(row.direction)}
            </p>
            <p className="text-sm text-stone-700">{row.reason_human || row.reason || "Причина не указана."}</p>
            {row.decision ? <p className="text-xs text-stone-500">Решение: {row.decision === "allow" ? "пропуск" : row.decision === "deny" ? "отказ" : row.decision}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
