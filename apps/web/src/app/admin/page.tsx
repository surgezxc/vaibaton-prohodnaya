"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoginCard } from "@/components/login-card";
import { Notice, Panel, RoleWarning, Shell } from "@/components/shell";
import { useSession } from "@/components/use-session";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import { formatDay, formatWhen } from "@/lib/format";
import type { Session } from "@/lib/session";

type Person = {
  id: string;
  full_name: string;
  keycloak_sub: string | null;
  badge_number: string | null;
  position: string | null;
  company: string | null;
  site_name: string | null;
  issuer: string | null;
  valid_until: string | null;
  enrolled: boolean;
  status: string;
  inside_since: string | null;
};

type Draft = {
  id: string | null;
  full_name: string;
  keycloak_sub: string;
  badge_number: string;
  position: string;
  company: string;
  site_name: string;
  issuer: string;
  valid_until: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  full_name: "",
  keycloak_sub: "",
  badge_number: "",
  position: "",
  company: "",
  site_name: "",
  issuer: "",
  valid_until: "",
});

export default function AdminPage() {
  const { session, login, logout } = useSession();
  return (
    <Shell current="/admin" session={session} onLogout={logout}>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Кадры</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Люди и эталон</h1>
      <p className="mt-2 mb-5 max-w-2xl text-stone-600">
        Заведите человека и свяжите его с учёткой рабочего. Эталон сохраняет только сервер, и только если на фото одно лицо.
      </p>
      {session ? (
        <>
          <div className="mb-4">
            <RoleWarning session={session} role="admin" label="администратор" />
          </div>
          <AdminDesk session={session} />
        </>
      ) : (
        <LoginCard username="admin" onSuccess={login} />
      )}
    </Shell>
  );
}

function AdminDesk({ session }: { session: Session }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [file, setFile] = useState<File | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    const response = await apiRequest("/people", "GET", session.token);
    if (response.offline) {
      setPeople([]);
      setListError(offlineReason);
      return;
    }
    if (response.status !== 200) {
      setPeople([]);
      setListError(serverReason(response.json, "Список не загрузился."));
      return;
    }
    setPeople(asArray<Person>(response.json, "people"));
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  function fill(person: Person) {
    setDraft({
      id: person.id,
      full_name: person.full_name,
      keycloak_sub: person.keycloak_sub ?? "",
      badge_number: person.badge_number ?? "",
      position: person.position ?? "",
      company: person.company ?? "",
      site_name: person.site_name ?? "",
      issuer: person.issuer ?? "",
      valid_until: person.valid_until ?? "",
    });
    setFile(null);
    setFormError(null);
    setSaved(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setSaved(null);
    const body: Record<string, string | null> = {
      full_name: draft.full_name.trim() || null,
      keycloak_sub: draft.keycloak_sub.trim() || null,
      badge_number: draft.badge_number.trim() || null,
      position: draft.position.trim() || null,
      company: draft.company.trim() || null,
      site_name: draft.site_name.trim() || null,
      issuer: draft.issuer.trim() || null,
      valid_until: draft.valid_until.trim() || null,
    };
    if (file) {
      try {
        body.image_base64 = await fileToBase64(file);
      } catch {
        setPending(false);
        setFormError("Фото не прочиталось. Выберите файл ещё раз.");
        return;
      }
    }
    const path = draft.id ? `/people/${draft.id}` : "/people";
    const method = draft.id ? "PATCH" : "POST";
    const response = await apiRequest(path, method, session.token, body);
    setPending(false);
    if (response.offline) {
      setFormError(offlineReason);
      return;
    }
    if (response.status !== 200 && response.status !== 201) {
      setFormError(serverReason(response.json, "Карточка не сохранена."));
      return;
    }
    setSaved(serverReason(response.json, "Карточка сохранена."));
    setFile(null);
    if (!draft.id && response.json && typeof response.json.id === "string") {
      setDraft((current) => ({ ...current, id: String(response.json?.id) }));
    }
    await load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={draft.id ? "Правка карточки" : "Новый человек"}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <Field label="ФИО" value={draft.full_name} onChange={(value) => setDraft({ ...draft, full_name: value })} />
          <Field label="Учётка Keycloak, sub" value={draft.keycloak_sub} onChange={(value) => setDraft({ ...draft, keycloak_sub: value })} />
          <Field label="Табельный номер" value={draft.badge_number} onChange={(value) => setDraft({ ...draft, badge_number: value })} />
          <Field label="Должность" value={draft.position} onChange={(value) => setDraft({ ...draft, position: value })} />
          <Field label="Организация" value={draft.company} onChange={(value) => setDraft({ ...draft, company: value })} />
          <Field label="Объект" value={draft.site_name} onChange={(value) => setDraft({ ...draft, site_name: value })} />
          <Field label="Кем выдан пропуск" value={draft.issuer} onChange={(value) => setDraft({ ...draft, issuer: value })} />
          <label className="block text-sm font-medium">
            Пропуск до
            <input
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3"
              type="date"
              value={draft.valid_until}
              onChange={(event) => setDraft({ ...draft, valid_until: event.target.value })}
            />
          </label>
          <label className="block text-sm font-medium">
            Фото эталона
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-stone-500">sub виден на телефоне рабочего после входа. Если сервис лиц не поднят, сервер вернёт отказ и карточку с фото не сохранит.</p>
          {formError ? (
            <p className="text-sm text-red-800" role="alert">
              {formError}
            </p>
          ) : null}
          {saved ? <Notice tone="ok" title="Сохранено">{saved}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <button className="min-h-12 flex-1 rounded-xl bg-emerald-900 px-4 font-semibold text-white" type="submit" disabled={pending}>
              {pending ? "Сохраняем…" : draft.id ? "Обновить" : "Завести"}
            </button>
            <button
              className="min-h-12 rounded-xl border border-stone-300 px-4 font-semibold"
              type="button"
              onClick={() => {
                setDraft(emptyDraft());
                setFile(null);
                setFormError(null);
                setSaved(null);
              }}
            >
              Новая карточка
            </button>
          </div>
        </form>
      </Panel>
      <Panel
        title="Список"
        aside={
          <div className="flex gap-3 text-sm font-semibold">
            <Link href="/admin/zones" className="text-emerald-900">
              План и зоны
            </Link>
            <Link href="/admin/journal" className="text-emerald-900">
              Журнал
            </Link>
          </div>
        }
      >
        {people === null ? <p className="text-sm text-stone-600">Загружаем список…</p> : null}
        {listError ? (
          <p className="mb-3 text-sm text-red-800" role="alert">
            {listError}
          </p>
        ) : null}
        {people && people.length === 0 && !listError ? <p className="text-sm text-stone-600">Людей пока нет. Заведите карточку и приложите эталон.</p> : null}
        <ul className="grid gap-3">
          {people?.map((person) => (
            <li key={person.id} className="rounded-xl border border-stone-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong>{person.full_name}</strong>
                  <p className="text-sm text-stone-600">
                    {person.status}
                    {person.inside_since ? ` с ${formatWhen(person.inside_since)}` : ""} · {person.enrolled ? "эталон есть" : "эталона нет"}
                  </p>
                  <p className="text-xs text-stone-500">
                    {[person.position, person.company].filter(Boolean).join(" · ") || "должность не указана"}
                    {person.valid_until ? ` · пропуск до ${formatDay(person.valid_until)}` : ""}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button type="button" className="font-semibold text-emerald-900 underline" onClick={() => fill(person)}>
                    Править
                  </button>
                  <Link className="font-semibold text-emerald-900" href={`/admin/journal?person_id=${person.id}`}>
                    Журнал
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("файл не прочитан"));
    reader.readAsDataURL(file);
  });
}
