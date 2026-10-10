"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { API_PATHS, displayPersonName, listFrom, personFormData, statusLabel, type JournalEntry, type Person } from "@/lib/contracts";
import { useAuth } from "./auth-provider";
import { AccessGate } from "./access-gate";
import { DashboardShell } from "./dashboard-shell";
import { SitePlan } from "./zone-editor";

type Tab = "people" | "zones" | "journal";
type PersonForm = {
  full_name: string;
  badge_system: string;
  badge_number: string;
  position: string;
  contractor: string;
  object_name: string;
  valid_until: string;
  keycloak_sub: string;
};

const initialForm: PersonForm = {
  full_name: "",
  badge_system: "",
  badge_number: "",
  position: "",
  contractor: "",
  object_name: "",
  valid_until: "",
  keycloak_sub: "",
};

function AdminContent() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("people");
  const [people, setPeople] = useState<Person[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [journalLoading, setJournalLoading] = useState(true);
  const [peopleError, setPeopleError] = useState("");
  const [journalError, setJournalError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<PersonForm>(initialForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    setPeopleLoading(true);
    setJournalLoading(true);
    setPeopleError("");
    setJournalError("");
    const [peopleResult, journalResult] = await Promise.allSettled([
      api<unknown>(API_PATHS.people, token),
      api<unknown>(API_PATHS.journal, token),
    ]);
    if (peopleResult.status === "fulfilled") setPeople(listFrom<Person>(peopleResult.value));
    else setPeopleError(peopleResult.reason instanceof Error ? peopleResult.reason.message : "Не удалось загрузить список людей.");
    if (journalResult.status === "fulfilled") setJournal(listFrom<JournalEntry>(journalResult.value, ["items", "data", "rows", "journal"]));
    else setJournalError(journalResult.reason instanceof Error ? journalResult.reason.message : "Не удалось загрузить журнал.");
    setPeopleLoading(false);
    setJournalLoading(false);
  }, [token]);

  useEffect(() => { void loadData(); }, [loadData]);

  const onSavePerson = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setSuccess("");
    if (!editingId && !photo) {
      setFormError("Добавьте эталонное фото. Лицо проверит сервер.");
      return;
    }
    setSaving(true);
    try {
      await api(editingId ? API_PATHS.people + "/" + encodeURIComponent(editingId) : API_PATHS.people, token, {
        method: editingId ? "PATCH" : "POST",
        body: personFormData(form, photo || undefined),
      });
      setSuccess(editingId ? "Карточка обновлена." : "Запись создана. Эталон принят сервером.");
      setForm(initialForm);
      setPhoto(null);
      setEditingId("");
      setShowForm(false);
      await loadData();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Не удалось сохранить человека.");
    } finally {
      setSaving(false);
    }
  };

  function editPerson(person: Person) {
    if (!person.id) return;
    setEditingId(person.id);
    setForm({
      full_name: person.full_name || "",
      badge_system: person.badge_system || "",
      badge_number: person.badge_number || "",
      position: person.position || "",
      contractor: person.contractor || "",
      object_name: person.object_name || "",
      valid_until: person.valid_until || "",
      keycloak_sub: person.keycloak_sub || "",
    });
    setPhoto(null);
    setFormError("");
    setShowForm(true);
    setTab("people");
  }

  const peopleOnSite = useMemo(() => people.filter((person) => (person.status || "").toLowerCase() === "inside").length, [people]);
  const latest = useMemo(() => [...journal].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))), [journal]);

  return (
    <DashboardShell active="admin">
      <div className="page-heading">
        <div><div className="eyebrow">АДМИНИСТРИРОВАНИЕ</div><h1>Сотрудники и проходы</h1><p>Управляйте карточками людей, эталонами и схемой площадки.</p></div>
        <div className="heading-actions"><span className="live-pill"><span className="status-dot" /> Данные сервера</span><button className="button button-primary" onClick={() => { setEditingId(""); setForm(initialForm); setPhoto(null); setShowForm((value) => !value); setFormError(""); }}>＋ Добавить человека</button></div>
      </div>
      <div className="stat-grid admin-stats">
        <div className="stat-card"><div className="stat-label">Людей в системе</div><strong>{peopleLoading ? "—" : people.length}</strong><span>Карточки сотрудников</span></div>
        <div className="stat-card"><div className="stat-label">На площадке</div><strong>{peopleLoading ? "—" : peopleOnSite}</strong><span>По статусу открытой смены</span></div>
        <div className="stat-card"><div className="stat-label">Попыток в журнале</div><strong>{journalLoading ? "—" : journal.length}</strong><span>Успешные и отклонённые</span></div>
      </div>
      {success && <div className="notice notice-success page-notice">{success}</div>}
      {showForm && (
        <section className="panel form-panel">
          <div className="panel-heading"><div><div className="eyebrow">{editingId ? "ИЗМЕНЕНИЕ КАРТОЧКИ" : "НОВАЯ КАРТОЧКА"}</div><h2>Данные пропуска</h2></div><button className="icon-button" aria-label="Закрыть форму" onClick={() => { setShowForm(false); setEditingId(""); setForm(initialForm); setPhoto(null); }}>×</button></div>
          <form onSubmit={(event) => void onSavePerson(event)}>
            <div className="form-grid">
              <label className="field field-wide"><span>ФИО</span><input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="Фамилия Имя Отчество" /></label>
              <label className="field"><span>Система / серия бейджа</span><input required value={form.badge_system} onChange={(event) => setForm({ ...form, badge_system: event.target.value })} placeholder="СтройГрад-Тест" /></label>
              <label className="field"><span>Номер пропуска</span><input required value={form.badge_number} onChange={(event) => setForm({ ...form, badge_number: event.target.value })} placeholder="314" /></label>
              <label className="field"><span>Должность</span><input required value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="Арматурщик" /></label>
              <label className="field"><span>Подрядчик</span><input required value={form.contractor} onChange={(event) => setForm({ ...form, contractor: event.target.value })} placeholder="ООО «МонолитПодряд»" /></label>
              <label className="field"><span>Объект</span><input required value={form.object_name} onChange={(event) => setForm({ ...form, object_name: event.target.value })} placeholder="ЖК Северный" /></label>
              <label className="field"><span>Пропуск действует до</span><input required type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></label>
              <label className="field field-wide"><span>Учётная запись рабочего · Keycloak sub</span><input value={form.keycloak_sub} onChange={(event) => setForm({ ...form, keycloak_sub: event.target.value })} placeholder="Идентификатор из учётной записи worker" /></label>
              <label className="field field-wide"><span>Эталонное фото{editingId ? " · можно заменить" : ""}</span><input required={!editingId} type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /><small>Фото отправляется на сервер для проверки: сохранить можно только кадр ровно с одним человеком.</small></label>
            </div>
            {formError && <div className="notice notice-error">{formError}</div>}
            <div className="form-actions"><span className="muted small">Сервер проверит пригодность фотографии до создания записи.</span><button className="button button-primary" disabled={saving}>{saving ? "Проверяем и сохраняем…" : "Сохранить карточку"}</button></div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="tabs">
          <button className={tab === "people" ? "tab active" : "tab"} onClick={() => setTab("people")}>Люди <span>{peopleLoading ? "…" : people.length}</span></button>
          <button className={tab === "zones" ? "tab active" : "tab"} onClick={() => setTab("zones")}>Зоны и схема</button>
          <button className={tab === "journal" ? "tab active" : "tab"} onClick={() => setTab("journal")}>Журнал <span>{journalLoading ? "…" : journal.length}</span></button>
          <button className="button button-quiet refresh-button" onClick={() => void loadData()}>↻ Обновить</button>
        </div>
        {tab === "people" && <div className="table-wrap">
          {peopleLoading ? <div className="state-block"><span className="loader" /><p>Загружаем людей…</p></div> : peopleError ? <div className="state-block state-error"><strong>Список недоступен</strong><p>{peopleError}</p><button className="button button-secondary" onClick={() => void loadData()}>Повторить</button></div> : people.length === 0 ? <div className="state-block"><div className="empty-icon">♙</div><strong>Людей пока нет</strong><p>Добавьте карточку и эталонное фото. Сервер проверит, что на фото один человек.</p><button className="button button-primary" onClick={() => setShowForm(true)}>Добавить первого человека</button></div> : <table><thead><tr><th>Сотрудник</th><th>Пропуск</th><th>Подрядчик</th><th>Статус</th><th>Учётная запись</th><th></th></tr></thead><tbody>{people.map((person, index) => <tr key={person.id || index}><td><b>{displayPersonName(person)}</b><small>{person.position || "Должность не указана"}</small></td><td>{person.badge_number || "—"}<small>{person.badge_system || "—"}</small></td><td>{person.contractor || "—"}<small>{person.object_name || ""}</small></td><td><span className={(person.status || "").toLowerCase() === "inside" ? "person-status inside" : "person-status"}><span className="status-dot" />{statusLabel(person.status)}</span></td><td className="mono">{person.keycloak_sub || "Не связана"}</td><td><button className="button button-quiet row-action" disabled={!person.id} onClick={() => editPerson(person)}>Изменить</button></td></tr>)}</tbody></table>}
        </div>}
        {tab === "zones" && <div className="panel-inner"><SitePlan token={token} /></div>}
        {tab === "journal" && <div className="table-wrap">
          {journalLoading ? <div className="state-block"><span className="loader" /><p>Загружаем журнал…</p></div> : journalError ? <div className="state-block state-error"><strong>Журнал недоступен</strong><p>{journalError}</p><button className="button button-secondary" onClick={() => void loadData()}>Повторить</button></div> : journal.length === 0 ? <div className="state-block"><div className="empty-icon">◷</div><strong>Попыток пока нет</strong><p>Здесь появятся все удачные и отклонённые попытки прохода.</p></div> : <table><thead><tr><th>Время</th><th>Человек</th><th>Направление</th><th>Результат</th><th>Причина</th></tr></thead><tbody>{latest.map((entry, index) => <tr key={entry.id || index}><td>{formatDateTime(entry.created_at)}</td><td><b>{entry.person_name || "Не определён"}</b></td><td>{entry.direction || "—"}</td><td><span className={(entry.result || "").toLowerCase() === "accepted" || (entry.result || "").toLowerCase() === "success" ? "result-tag good" : "result-tag"}>{entry.result || entry.event || "—"}</span></td><td>{entry.reason_human || "—"}</td></tr>)}</tbody></table>}
        </div>}
      </section>
    </DashboardShell>
  );
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function AdminDashboard() {
  return <AccessGate role="admin"><AdminContent /></AccessGate>;
}
