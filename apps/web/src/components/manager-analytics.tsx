"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/shell";
import { SitePlan, type PlanShape } from "@/components/site-plan";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { loadPlanImage, readRing, ringToPixels, zoneLook, type Plan, type PlanImage, type Zone } from "@/lib/site";

export type Period = { from: string; to: string };

type Filters = { mode: "day" | "range"; day: string; from: string; to: string; hourFrom: string; hourTo: string; people: string[] };
type RoutePerson = { person_id: string; full_name: string; visits: Array<{ zone_id: string; zone_name: string; started_at: string; ended_at: string | null }> };
type ReportPerson = { person_id: string; full_name: string; shift_count: number; duration_seconds: number; visits: Array<{ zone_name: string; count: number }> };

export function moscowToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

function query(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.mode === "day") params.set("day", filters.day);
  else {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.hourFrom !== "") params.set("hour_from", filters.hourFrom);
  if (filters.hourTo !== "") params.set("hour_to", filters.hourTo);
  for (const id of filters.people) params.append("person_id", id);
  return params.toString();
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

function heatColor(visits: number, max: number): string {
  const ratio = Math.max(0, Math.min(1, visits / max));
  const start = [220, 235, 215];
  const end = [40, 120, 80];
  return `rgb(${start.map((c, i) => Math.round(c + (end[i] - c) * ratio)).join(",")})`;
}

const hours = Array.from({ length: 24 }, (_, hour) => hour);

export function ManagerAnalytics({ token, onPeriod }: { token: string; onPeriod?: (period: Period) => void }) {
  const today = moscowToday();
  const [draft, setDraft] = useState<Filters>({ mode: "day", day: today, from: today, to: today, hourFrom: "", hourTo: "", people: [] });
  const [people, setPeople] = useState<Array<{ id: string; full_name: string }>>([]);
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [routes, setRoutes] = useState<RoutePerson[]>([]);
  const [report, setReport] = useState<ReportPerson[]>([]);
  const [plan, setPlan] = useState<{ plan: Plan; image: PlanImage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(
    async (filters: Filters) => {
      setPending(true);
      setError(null);
      const q = query(filters);
      const [heat, routeRes, reportRes] = await Promise.all([
        apiRequest(`/analytics/heat?${q}`, "GET", token),
        apiRequest(`/analytics/routes?${q}`, "GET", token),
        apiRequest(`/analytics/reports?${q}`, "GET", token),
      ]);
      setPending(false);
      const failed = [heat, routeRes, reportRes].find((r) => r.offline || r.status !== 200);
      if (failed) setError(failed.offline ? offlineReason : serverReason(failed.json, "Часть аналитики не загрузилась."));
      setZones(
        asArray<Record<string, unknown>>(heat.json, "zones").map((row) => ({
          id: String(row.id),
          name: String(row.name),
          photo_id: typeof row.photo_id === "string" ? row.photo_id : null,
          polygon: readRing(row.polygon),
          visits: Number(row.visits ?? 0),
          empty: Boolean(row.empty),
        })),
      );
      setRoutes(asArray<RoutePerson>(routeRes.json, "people"));
      setReport(asArray<ReportPerson>(reportRes.json, "by_person"));
      onPeriod?.(filters.mode === "day" ? { from: filters.day, to: filters.day } : { from: filters.from, to: filters.to });
    },
    [token, onPeriod],
  );

  useEffect(() => {
    void load(draft);
    void (async () => {
      const [peopleRes, plansRes] = await Promise.all([apiRequest("/people", "GET", token), apiRequest("/plans", "GET", token)]);
      setPeople(asArray<{ id: string; full_name: string }>(peopleRes.json, "people"));
      const first = asArray<Plan>(plansRes.json, "plans").find((item) => loadPlanImage(item.id));
      const image = first ? loadPlanImage(first.id) : null;
      if (first && image) setPlan({ plan: first, image });
    })();
  }, [token, load]);

  const max = useMemo(() => Math.max(1, ...(zones ?? []).map((z) => z.visits)), [zones]);
  const total = (zones ?? []).reduce((sum, z) => sum + z.visits, 0);

  const shapes: PlanShape[] = plan
    ? (zones ?? []).flatMap((zone) => {
        const points = ringToPixels(zone.polygon);
        if (!points) return [];
        const color = zone.visits ? heatColor(zone.visits, max) : "#b4bcb6";
        return [{ id: zone.id, points, fill: color, stroke: zoneLook(zone.name).color, label: `${zone.name} · ${zone.visits}`, opacity: zone.visits ? 0.75 : 0.3 }];
      })
    : [];

  function apply(event: FormEvent) {
    event.preventDefault();
    void load(draft);
  }

  const input = "mt-1 w-full rounded-xl border border-stone-300 px-3 py-2";

  return (
    <div className="grid gap-4">
      <Panel title="Период и фильтры">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium">
            Период
            <select className={input} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Filters["mode"] })}>
              <option value="day">Один день</option>
              <option value="range">Диапазон дат</option>
            </select>
          </label>
          {draft.mode === "day" ? (
            <label className="block text-sm font-medium">
              День
              <input className={input} type="date" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-medium">
                С
                <input className={input} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label className="block text-sm font-medium">
                По
                <input className={input} type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["hourFrom", "hourTo"] as const).map((key) => (
              <label key={key} className="block text-sm font-medium">
                {key === "hourFrom" ? "Час с" : "Час по"}
                <select className={input} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                  <option value="">любой</option>
                  {hours.map((h) => (
                    <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="block text-sm font-medium">
            Люди
            <select
              className={`${input} h-24`}
              multiple
              value={draft.people}
              onChange={(e) => setDraft({ ...draft, people: Array.from(e.target.selectedOptions, (o) => o.value) })}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="min-h-11 rounded-xl bg-emerald-900 px-5 font-semibold text-white" disabled={pending}>
              {pending ? "Считаем…" : "Применить"}
            </button>
            {draft.people.length ? (
              <button type="button" className="min-h-11 rounded-xl border border-stone-300 px-4 text-sm" onClick={() => setDraft({ ...draft, people: [] })}>
                Все люди
              </button>
            ) : null}
            <span className="text-xs text-stone-500">Без выбранных людей показываются все. Время — московское.</span>
          </div>
        </form>
        {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Посещаемость зон" aside={<span className="text-sm text-stone-600">всего {total}</span>}>
          {zones === null ? <p className="text-sm text-stone-600">Загружаем посещения…</p> : null}
          {zones && zones.length === 0 ? <p className="text-sm text-stone-600">Зон нет в ответе сервера.</p> : null}
          <ul className="grid gap-3">
            {zones?.map((zone) => (
              <li key={zone.id} className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: zoneLook(zone.name).color }} />
                  {zone.name}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-stone-100">
                  <span className="block h-full rounded-full" style={{ width: `${zone.visits ? Math.max(4, (zone.visits / max) * 100) : 0}%`, background: heatColor(zone.visits, max) }} />
                </span>
                <b className="text-right">{zone.visits}</b>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">Метрика — посещения. Цвет и длина полосы — относительно максимума выборки, порога «много» нет.</p>
        </Panel>

        <Panel title="Тепловая карта на плане">
          {plan && shapes.length ? (
            <SitePlan image={plan.image} shapes={shapes} />
          ) : (
            <p className="text-sm text-stone-600">
              {plan ? "У зон нет границ на плане. Обведите их в «Кадры → План и зоны»." : "План не открыт в этом браузере. Загрузите его в «Кадры → План и зоны»."}
            </p>
          )}
        </Panel>
      </div>

      <Panel title={`Маршруты людей: ${routes.length}`}>
        {routes.length === 0 ? <p className="text-sm text-stone-600">Маршрутов за период нет. Они появляются из точек геолокации открытых смен.</p> : null}
        <ul className="grid gap-3">
          {routes.map((person) => (
            <li key={person.person_id} className="rounded-xl border border-stone-200 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{person.full_name}</strong>
                <span className="text-xs text-stone-500">{person.visits.length} посещ.</span>
              </div>
              {person.visits.length ? (
                <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                  {person.visits.map((visit, index) => (
                    <li key={index} className="flex items-center gap-1">
                      {index ? <span className="text-stone-400">→</span> : null}
                      <span className="rounded-full px-2 py-0.5" style={{ background: `${zoneLook(visit.zone_name).color}22` }}>
                        {visit.zone_name} <small className="text-stone-500">{formatWhen(visit.started_at).slice(-5)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-sm text-stone-600">Точки есть, но ни одна не попала в зону.</p>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Отчёт по людям">
        {report.length === 0 ? <p className="text-sm text-stone-600">Смен за период нет.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-stone-500 uppercase">
                <tr>
                  <th className="py-2 pr-3">Человек</th>
                  <th className="py-2 pr-3">Смен</th>
                  <th className="py-2 pr-3">Время на объекте</th>
                  <th className="py-2">Посещения зон</th>
                </tr>
              </thead>
              <tbody>
                {report.map((row) => (
                  <tr key={row.person_id} className="border-t border-stone-100">
                    <td className="py-2 pr-3 font-medium">{row.full_name}</td>
                    <td className="py-2 pr-3">{row.shift_count}</td>
                    <td className="py-2 pr-3">{duration(row.duration_seconds)}</td>
                    <td className="py-2">{row.visits.length ? row.visits.map((v) => `${v.zone_name} ${v.count}`).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
