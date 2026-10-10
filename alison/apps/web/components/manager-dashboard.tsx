"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, queryString } from "@/lib/api";
import {
  API_PATHS,
  displayPersonName,
  listFrom,
  type AssistantResult,
  type CurrentPerson,
  type HeatZone,
  type Person,
  type ReportRow,
  type RoutePoint,
} from "@/lib/contracts";
import { useAuth } from "./auth-provider";
import { AccessGate } from "./access-gate";
import { DashboardShell } from "./dashboard-shell";

const PLAN_KEY = "prohodnaya:site-plan";
const PLAN_SIZE_KEY = "prohodnaya:site-plan-size";
const SHAPES_KEY = "prohodnaya:zone-shapes";
type PeriodMode = "day" | "range";
type AnalyticsFilters = { mode: PeriodMode; day: string; from: string; to: string; timeFrom: string; timeTo: string; people: string[] };

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function visitCount(zone: HeatZone) {
  const value = Number(zone.visits ?? zone.visit_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function heatColor(visits: number, maxVisits: number) {
  const ratio = Math.max(0, Math.min(1, visits / maxVisits));
  const start = [220, 235, 215];
  const end = [75, 145, 100];
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio));
  return `rgb(${channels.join(",")})`;
}

function ManagerContent() {
  const { token } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [inside, setInside] = useState<CurrentPerson[]>([]);
  const [heat, setHeat] = useState<HeatZone[]>([]);
  const [routes, setRoutes] = useState<RoutePoint[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [plan, setPlan] = useState("");
  const [planSize, setPlanSize] = useState({ width: 0, height: 0 });
  const [planShapes, setPlanShapes] = useState<Record<string, Array<{ x: number; y: number }>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadTime, setLoadTime] = useState("");
  const [mode, setMode] = useState<PeriodMode>("day");
  const [day, setDay] = useState(today());
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [timeFrom, setTimeFrom] = useState("07:00");
  const [timeTo, setTimeTo] = useState("19:00");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [filters, setFilters] = useState<AnalyticsFilters>({ mode: "day", day: today(), from: today(), to: today(), timeFrom: "07:00", timeTo: "19:00", people: [] });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [assistantError, setAssistantError] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);

  const loadCurrent = useCallback(async () => {
    try {
      const current = await api<unknown>(API_PATHS.siteNow, token);
      setInside(listFrom<CurrentPerson>(current, ["items", "data", "people", "workers"]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить обстановку.");
    }
  }, [token]);

  const loadPeople = useCallback(async () => {
    try {
      const peopleData = await api<unknown>(API_PATHS.people, token);
      setPeople(listFrom<Person>(peopleData));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить список людей для фильтра.");
    }
  }, [token]);

  const loadAnalytics = useCallback(async (activeFilters: AnalyticsFilters, quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError("");
    const dateFrom = activeFilters.mode === "day" ? activeFilters.day : activeFilters.from;
    const dateTo = activeFilters.mode === "day" ? activeFilters.day : activeFilters.to;
    const query = queryString({
      date_from: dateFrom,
      date_to: dateTo,
      time_from: activeFilters.timeFrom,
      time_to: activeFilters.timeTo,
      people: activeFilters.people,
    });
    const [heatResult, routesResult, reportsResult, currentResult] = await Promise.allSettled([
      api<unknown>(API_PATHS.analyticsHeat + query, token),
      api<unknown>(API_PATHS.analyticsRoutes + query, token),
      api<unknown>(API_PATHS.analyticsReports + query, token),
      api<unknown>(API_PATHS.siteNow, token),
    ]);
    const failures = [heatResult, routesResult, reportsResult, currentResult].filter((result) => result.status === "rejected");
    if (heatResult.status === "fulfilled") setHeat(listFrom<HeatZone>(heatResult.value, ["items", "data", "zones", "visits"]));
    else setHeat([]);
    if (routesResult.status === "fulfilled") setRoutes(listFrom<RoutePoint>(routesResult.value, ["items", "data", "routes", "points"]));
    else setRoutes([]);
    if (reportsResult.status === "fulfilled") setReports(listFrom<ReportRow>(reportsResult.value, ["items", "data", "reports", "shifts"]));
    else setReports([]);
    if (currentResult.status === "fulfilled") setInside(listFrom<CurrentPerson>(currentResult.value, ["items", "data", "people", "workers"]));
    if (failures.length) {
      const first = failures[0];
      setError(first.status === "rejected" && first.reason instanceof Error ? first.reason.message : "Часть данных недоступна.");
    }
    setLoadTime(new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useEffect(() => {
    const savedPlan = localStorage.getItem(PLAN_KEY) || "";
    setPlan(savedPlan);
    let savedDimensions: { width: number; height: number } | null = null;
    try {
      const candidate = JSON.parse(localStorage.getItem(PLAN_SIZE_KEY) || "null") as { width?: number; height?: number } | null;
      if (candidate?.width && candidate.height) savedDimensions = { width: candidate.width, height: candidate.height };
    } catch {
      savedDimensions = null;
    }
    if (savedDimensions) setPlanSize(savedDimensions);
    if (savedPlan) {
      const image = new Image();
      image.onload = () => { if (!savedDimensions) setPlanSize({ width: image.naturalWidth, height: image.naturalHeight }); };
      image.src = savedPlan;
    }
    try {
      setPlanShapes(JSON.parse(localStorage.getItem(SHAPES_KEY) || "{}"));
    } catch {
      setPlanShapes({});
    }
    void loadPeople();
    void loadAnalytics({ mode: "day", day: today(), from: today(), to: today(), timeFrom: "07:00", timeTo: "19:00", people: [] }, false);
    const timer = window.setInterval(() => { void loadCurrent(); }, 30000);
    return () => window.clearInterval(timer);
  }, [loadCurrent, loadPeople, loadAnalytics]);

  const totalVisits = useMemo(() => heat.reduce((sum, zone) => sum + visitCount(zone), 0), [heat]);
  const activeZones = useMemo(() => heat.filter((zone) => visitCount(zone) > 0).length, [heat]);
  const maxVisits = useMemo(() => Math.max(1, ...heat.map(visitCount)), [heat]);
  const groupedRoutes = useMemo(() => {
    const groups = new Map<string, RoutePoint[]>();
    for (const point of routes) {
      const key = point.person_id || point.person_name || point.full_name || "unknown-" + groups.size;
      groups.set(key, [...(groups.get(key) || []), point]);
    }
    return Array.from(groups.entries());
  }, [routes]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: AnalyticsFilters = { mode, day, from, to, timeFrom, timeTo, people: selectedPeople };
    setFilters(next);
    void loadAnalytics(next);
  }

  async function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setAssistantBusy(true);
    setAssistantError("");
    setAnswer("");
    try {
      const result = await api<AssistantResult>(API_PATHS.assistantAsk, token, {
        method: "POST",
        body: JSON.stringify({ question: question.trim() }),
      });
      setAnswer(result.answer || result.text || result.message || "Система не вернула текстовый ответ.");
    } catch (cause) {
      setAssistantError(cause instanceof Error ? cause.message : "Помощник временно недоступен.");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function requestSummary() {
    setSummaryBusy(true);
    setSummaryError("");
    setSummary("");
    const dateFrom = filters.mode === "day" ? filters.day : filters.from;
    const dateTo = filters.mode === "day" ? filters.day : filters.to;
    try {
      const result = await api<AssistantResult>(API_PATHS.assistantSummary, token, {
        method: "POST",
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
      });
      setSummary(result.answer || result.text || result.message || "Система не вернула сводку.");
    } catch (cause) {
      setSummaryError(cause instanceof Error ? cause.message : "Не удалось подготовить сводку.");
    } finally {
      setSummaryBusy(false);
    }
  }

  return (
    <DashboardShell active="manager">
      <div className="page-heading manager-heading">
        <div><div className="eyebrow">ОБСТАНОВКА ПЛОЩАДКИ</div><h1>Обзор объекта</h1><p>Текущее присутствие, посещения зон и смены за выбранный период.</p></div>
        <div className="heading-actions"><span className="live-pill"><span className="status-dot" /> Обновлено {loadTime || "—"}</span><button className="button button-secondary" onClick={() => void loadAnalytics(filters, true)} disabled={refreshing}>↻ {refreshing ? "Обновляем…" : "Обновить"}</button></div>
      </div>
      {error && <div className="notice notice-warning page-notice"><b>Часть данных не загружена.</b> {error}</div>}
      <form className="filter-panel" onSubmit={applyFilters}>
        <div className="filter-title"><div><b>Фильтры аналитики</b><span>Тепловая карта и маршруты используют одни параметры.</span></div><button className="button button-primary" disabled={loading}>Применить</button></div>
        <div className="filters-row">
          <label className="field"><span>Период</span><select value={mode} onChange={(event) => setMode(event.target.value as PeriodMode)}><option value="day">Один день</option><option value="range">Диапазон дат</option></select></label>
          {mode === "day" ? <label className="field"><span>День</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label> : <><label className="field"><span>С</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="field"><span>По</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></>}
          <label className="field"><span>Время с</span><input type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} /></label>
          <label className="field"><span>Время до</span><input type="time" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} /></label>
          <label className="field people-filter"><span>Люди</span><select multiple value={selectedPeople} onChange={(event) => setSelectedPeople(Array.from(event.target.selectedOptions, (option) => option.value))} aria-label="Фильтр по людям"><option value="" disabled>Все люди — снять выбор</option>{people.map((person) => <option key={person.id} value={person.id}>{displayPersonName(person)}</option>)}</select><small>Без выбранных людей показываются все.</small></label>
        </div>
      </form>
      <div className="manager-stat-grid">
        <div className="manager-stat panel"><div className="manager-stat-icon green">◉</div><div><span>Сейчас на объекте</span><strong>{loading ? "—" : inside.length}</strong><small>По открытым сменам</small></div></div>
        <div className="manager-stat panel"><div className="manager-stat-icon amber">⌖</div><div><span>Посещения зон</span><strong>{loading ? "—" : totalVisits}</strong><small>За выбранный период</small></div></div>
        <div className="manager-stat panel"><div className="manager-stat-icon blue">▤</div><div><span>Зоны с посещениями</span><strong>{loading ? "—" : activeZones}</strong><small>Из {heat.length} зон в ответе</small></div></div>
      </div>
      <div className="manager-grid">
        <section className="panel inside-panel">
          <div className="panel-heading"><div><div className="eyebrow">ПРИСУТСТВИЕ</div><h2>Сейчас на площадке</h2></div><span className="count-badge">{inside.length}</span></div>
          {loading ? <div className="compact-state"><span className="loader" /> Загружаем список…</div> : inside.length === 0 ? <div className="compact-empty"><span className="empty-icon">⌂</span><b>Сейчас никого нет</b><p>Здесь отображаются люди с открытой сменой.</p></div> : <div className="inside-list">{inside.map((person, index) => <div className="inside-row" key={person.person_id || index}><span className="avatar">{displayPersonName(person).slice(0, 1)}</span><div className="inside-person"><b>{displayPersonName(person)}</b><span>На объекте с {dateLabel(person.started_at || person.shift_started_at)}</span></div><span className="open-shift"><i />Смена открыта</span></div>)}</div>}
        </section>
        <section className="panel heat-panel">
          <div className="panel-heading"><div><div className="eyebrow">ПЕРЕМЕЩЕНИЯ</div><h2>Посещаемость зон</h2></div><span className="metric-pill">Метрика · посещения</span></div>
          {loading ? <div className="compact-state"><span className="loader" /> Загружаем посещения…</div> : heat.length === 0 ? <div className="compact-empty"><span className="empty-icon">⌖</span><b>Нет данных за период</b><p>Когда появятся записи о перемещениях, интенсивность по зонам отобразится здесь.</p></div> : <div className="heat-list">{heat.map((zone, index) => {
            const visits = visitCount(zone);
            return <div className="heat-row" key={zone.zone_id || index}><div className="heat-zone-name"><span className={"heat-marker " + (visits === 0 ? "zero" : "")} />{zone.zone_name || zone.name || "Зона без названия"}</div><div className="heat-track"><span className={visits === 0 ? "heat-bar zero" : "heat-bar"} style={{ width: (visits ? Math.max(5, visits / maxVisits * 100) : 0) + "%" }} /></div><b className="heat-count">{visits}</b><small>{visits === 0 ? "Пусто" : "Есть посещения"}</small></div>;
          })}<div className="heat-legend"><span><i className="legend-zero" /> 0 посещений</span><span><i className="legend-gradient" /> Цвет и длина полосы показывают значение относительно максимума выборки</span></div></div>}
        </section>
      </div>
      <section className="panel site-overview">
        <div className="panel-heading"><div><div className="eyebrow">ПЛАН И МАРШРУТЫ</div><h2>Схема площадки</h2></div><span className="period-caption">{filters.mode === "day" ? filters.day : filters.from + " — " + filters.to}</span></div>
        {plan ? <div className="manager-plan"><img src={plan} alt="Загруженная схема строительной площадки" /><svg className="manager-site-canvas" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Зоны и посещения на схеме">
          {heat.map((zone, index) => {
            const points = zone.polygon?.length && planSize.width && planSize.height
              ? zone.polygon.map((point) => ({
                x: Number(point.pixel_x ?? point.x) / planSize.width * 100,
                y: Number(point.pixel_y ?? point.y) / planSize.height * 100,
              }))
              : (zone.zone_id ? planShapes[zone.zone_id] : undefined);
            if (!points || points.length < 3) return null;
            const visits = visitCount(zone);
            const middle = points.reduce((value, point) => ({ x: value.x + point.x / points.length, y: value.y + point.y / points.length }), { x: 0, y: 0 });
            const color = visits ? heatColor(visits, maxVisits) : "#b4bcb6";
            return <g key={zone.zone_id || index}><polygon points={points.map((point) => point.x + "," + point.y).join(" ")} fill={color} fillOpacity={visits ? ".8" : ".28"} stroke={color} strokeWidth=".65" vectorEffect="non-scaling-stroke" /><text x={middle.x} y={middle.y} textAnchor="middle" fill="#173f31" fontSize="3.2">{zone.zone_name || zone.name || "Зона"} · {visits}</text></g>;
          })}
        </svg>{heat.some((zone) => (zone.polygon?.length && (!planSize.width || !planSize.height)) || (!zone.polygon?.length && (!zone.zone_id || !planShapes[zone.zone_id]))) && <span className="map-hint">Нет контуров зон или размеров выбранного плана</span>}</div> : <div className="plan-missing"><span className="empty-icon">▧</span><div><b>Загрузите общую схему площадки в разделе администратора</b><p>Снимки отдельных камер показывают зоны, но не задают их расположение на общей схеме.</p></div></div>}
      </section>
      <section className="panel route-panel">
        <div className="panel-heading"><div><div className="eyebrow">ИСТОРИЯ ЗОН</div><h2>Маршруты людей</h2></div><span className="count-badge">{groupedRoutes.length}</span></div>
        {loading ? <div className="compact-state"><span className="loader" /> Загружаем маршруты…</div> : groupedRoutes.length === 0 ? <div className="compact-empty"><span className="empty-icon">↝</span><b>Маршрутов пока нет</b><p>Маршруты появятся после регистрации точек перемещения в открытых сменах.</p></div> : <div className="route-list">{groupedRoutes.map(([key, points], groupIndex) => { const sortedPoints = [...points].sort((a, b) => String(a.visited_at || a.created_at).localeCompare(String(b.visited_at || b.created_at))); return <div className="route-row" key={key}><div className="route-person"><span className={"avatar route-avatar route-color-" + (groupIndex % 5)}>{displayPersonName(points[0]).slice(0, 1)}</span><b>{displayPersonName(points[0])}</b></div><div className="route-timeline">{sortedPoints.map((point, index) => <div className="route-stop" key={index}><i className={"route-node route-color-" + (groupIndex % 5)} /><span><b>{point.zone_name || "Зона без названия"}</b><small>{dateLabel(point.visited_at || point.created_at)}</small></span></div>)}</div><span className="visit-total">{points.length} {points.length === 1 ? "переход" : "перехода"}</span></div>; })}</div>}
      </section>
      <div className="manager-grid lower-grid">
        <section className="panel reports-panel">
          <div className="panel-heading"><div><div className="eyebrow">СМЕНЫ И ПОСЕЩЕНИЯ</div><h2>Отчёт по людям</h2></div><span className="count-badge">{reports.length}</span></div>
          {loading ? <div className="compact-state"><span className="loader" /> Загружаем отчёт…</div> : reports.length === 0 ? <div className="compact-empty"><b>Нет смен за период</b><p>Отчёт появится, когда сервер вернёт смены и посещения.</p></div> : <div className="table-wrap report-table"><table><thead><tr><th>Человек</th><th>Начало</th><th>Время</th><th>Посещения</th></tr></thead><tbody>{reports.map((row, index) => <tr key={(row.person_id || "person") + ":" + (row.started_at || row.shift_started_at || index)}><td><b>{displayPersonName(row)}</b></td><td>{dateLabel(row.started_at || row.shift_started_at)}</td><td>{row.duration_minutes == null ? "—" : formatDuration(row.duration_minutes)}</td><td>{row.visits ?? "—"}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="panel assistant-panel">
          <div className="panel-heading"><div><div className="eyebrow">ПОМОЩНИК РУКОВОДИТЕЛЯ</div><h2>Спросите о площадке</h2></div><span className="assistant-spark">✳</span></div>
          <div className="suggestion-row">{["Кто сейчас на объекте?", "В какой зоне было больше всего людей?"].map((text) => <button className="suggestion" key={text} onClick={() => setQuestion(text)}>{text}</button>)}</div>
          <form className="assistant-form" onSubmit={(event) => void askAssistant(event)}><label className="sr-only" htmlFor="assistant-question">Ваш вопрос</label><input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Например: кто вчера работал меньше четырёх часов?" /><button className="button button-primary" disabled={assistantBusy || !question.trim()}>{assistantBusy ? "Считаем…" : "Спросить"}</button></form>
          {assistantError && <div className="notice notice-warning assistant-result">{assistantError}</div>}
          {answer && <div className="assistant-result"><b>Ответ по данным системы</b><p>{answer}</p></div>}
          <div className="summary-action"><span>Сводка по выбранному периоду</span><button className="button button-secondary" onClick={() => void requestSummary()} disabled={summaryBusy}>{summaryBusy ? "Готовим…" : "Подготовить"}</button></div>
          {summaryError && <div className="notice notice-warning assistant-result">{summaryError}</div>}
          {summary && <div className="assistant-result"><b>Сводка</b><p>{summary}</p></div>}
          <small className="muted">Карта и отчёты считают посещения. Вопрос о «большем числе людей» — о разных людях, не о посещениях. При отсутствии данных помощник сообщает об этом.</small>
        </section>
      </div>
    </DashboardShell>
  );
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? hours + " ч " + rest + " мин" : rest + " мин";
}

export function ManagerDashboard() {
  return <AccessGate role="manager"><ManagerContent /></AccessGate>;
}
