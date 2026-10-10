"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import { Panel } from "@/components/shell";

type Point = { at: string; lat: number | null; lng: number | null; zone_name: string | null; source: "gps" | "button" };
type Inside = { person_id: string; full_name: string; started_at: string };
type Route = { person_id: string; points: Point[] };
type Worker = Inside & { points: Point[] };
const zones = ["Бетон", "Котлован", "Курилка"];
const button = "min-h-11 rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";
const time = (at: string) => new Date(at).toLocaleString("ru-RU");
const day = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(at));

export function LocationMonitor({ token }: { token: string }) {
  const [demo, setDemo] = useState(false);
  const [demoPoints, setDemoPoints] = useState<Point[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (demo) return;
    let disposed = false;
    let running = false;
    async function load() {
      if (disposed || running || document.hidden) return;
      running = true; setPending(true);
      try {
        const inside = await apiRequest("/site/now", "GET", token);
        if (inside.offline || inside.status !== 200) throw new Error(inside.offline ? offlineReason : serverReason(inside.json, "Не удалось прочитать открытые смены."));
        const people = asArray<Inside>(inside.json, "inside");
        let routes: Route[] = [];
        if (people.length) {
          const earliest = people.reduce((a, b) => Date.parse(a.started_at) < Date.parse(b.started_at) ? a : b);
          const query = new URLSearchParams({ from: day(earliest.started_at) });
          people.forEach(p => query.append("person_id", p.person_id));
          const result = await apiRequest(`/analytics/routes?${query}`, "GET", token);
          if (result.offline || result.status !== 200) throw new Error(result.offline ? offlineReason : serverReason(result.json, "Не удалось прочитать местоположения."));
          routes = asArray<Route>(result.json, "people");
        }
        if (disposed) return;
        setWorkers(people.map(p => ({ ...p, points: (routes.find(r => r.person_id === p.person_id)?.points ?? [])
          .filter(point => Number.isFinite(Date.parse(point.at)) && Date.parse(point.at) >= Date.parse(p.started_at))
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) })));
        setUpdated(new Date().toISOString()); setNow(Date.now()); setError(null);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "Данные недоступны."); }
      finally { running = false; if (!disposed) setPending(false); }
    }
    void load();
    const timer = auto ? setInterval(() => void load(), 60000) : null;
    const visibility = () => { if (!document.hidden) { setNow(Date.now()); if (auto) void load(); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [token, demo, auto, refresh]);

  // Отдельный лёгкий таймер обновляет возраст отметки, даже при выключенном опросе API.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 15000);
    return () => clearInterval(timer);
  }, []);

  function demoZone(zone_name: string) {
    setDemoPoints(points => [...points.slice(-19), { at: new Date().toISOString(), lat: null, lng: null, source: "button", zone_name }]);
  }
  const shown: Worker[] = demo ? [{ person_id: "demo", full_name: "Демо-рабочий", started_at: "", points: demoPoints }] : workers;
  const focused = shown.find(p => p.person_id === selected) ?? shown[0];
  const stale = (p: Point | undefined) => !p || now - Date.parse(p.at) > 120000;

  const position = (name: string | null | undefined) => {
    const index = zones.indexOf(name ?? "");
    return index < 0 ? { x: 360, y: 275 } : { x: 125 + index * 235, y: 140 };
  };
  const latest = focused?.points.at(-1);
  const marker = position(latest?.zone_name);
  const trail = (focused?.points.slice(-6) ?? []).map(p => position(p.zone_name));

  return <Panel title="Местоположение рабочих" aside={<span className={`rounded-full px-3 py-1 text-sm ${demo ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-950"}`}>{demo ? "Демо · без записи в базу" : "Данные сервера"}</span>}>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className={button} aria-pressed={!demo} onClick={() => setDemo(false)}>Реальные смены</button>
      <button className={button} aria-pressed={demo} onClick={() => setDemo(true)}>Попробовать демо</button>
      {!demo && <><button className={button} disabled={pending} onClick={() => setRefresh(v => v + 1)}>{pending ? "Обновляем точки…" : "Обновить местоположения"}</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Обновлять раз в 60 секунд</label></>}
    </div>
    {demo ? <div className="mb-4 rounded-xl bg-amber-50 p-4">
      <p className="mb-3 text-sm">Локальная демонстрация: нажмите зону — метка вымышленного рабочего переместится. Реальные смены и GPS не меняются.</p>
      <div className="flex flex-wrap gap-2">{zones.map(name => <button className={button} key={name} onClick={() => demoZone(name)}>Демо: {name}</button>)}<button className={button} onClick={() => setDemoPoints([])}>Сбросить демо</button></div>
    </div> : <p className="mb-3 text-sm text-stone-600" role="status">{updated ? `Последнее обновление: ${time(updated)}.` : "Данные ещё не получены."} {auto ? "Опрос раз в минуту, пока страница видна." : "Автообновление выключено."}</p>}
    {!demo && error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-800">{error} Показанные ранее данные могли устареть. Проверьте сеть или войдите заново.</p>}
    <p className="mb-3 text-sm text-stone-600">Схема зон без масштаба: показывает последнюю полученную зону, а не точную позицию внутри неё. GPS и ручная симуляция помечены отдельно. Отметки старше двух минут считаются устаревшими.</p>
    <svg viewBox="0 0 720 320" role="img" aria-label="Схема объекта без масштаба: последние зоны выбранного рабочего" className="mb-4 block w-full rounded-xl border border-stone-200 bg-stone-50">
      <title>Условная схема зон. Линия показывает последовательность отметок выбранного рабочего.</title>
      {zones.map((name, i) => <g key={name}>
        <rect x={20 + i * 235} y="25" width="210" height="175" rx="18" fill={["#fef3c7", "#dbeafe", "#d1fae5"][i]} stroke={["#d97706", "#2563eb", "#059669"][i]} />
        <text x={125 + i * 235} y="60" textAnchor="middle" fontSize="20" fill="#1c1917">{name}</text>
      </g>)}
      <text x="360" y="240" textAnchor="middle" fontSize="16" fill="#57534e">Зона не определена</text>
      {trail.length > 1 && <polyline points={trail.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#64748b" strokeWidth="3" strokeDasharray="7 5" />}
      {focused && <g style={{ transform: `translate(${marker.x}px, ${marker.y}px)` }} className="motion-safe:transition-transform motion-safe:duration-500">
        <circle r="13" fill={demo || latest?.source === "button" ? "#7c3aed" : latest ? "#047857" : "#78716c"} stroke="white" strokeWidth="4" />
        <text y="30" textAnchor="middle" fontSize="16" fill="#1c1917" stroke="#fff" strokeWidth="4" paintOrder="stroke">{focused.full_name.length > 22 ? focused.full_name.slice(0, 21) + "…" : focused.full_name}</text>
      </g>}
    </svg>
    <p className="mb-3 text-xs text-stone-600">Зелёная метка — GPS, фиолетовая — симуляция, серая — нет данных. Пунктир — порядок последних зон выбранного рабочего, без восстановления реальной траектории.</p>
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Схема местоположения по зонам">
      {[...zones, "Зона не определена"].map((zone, i) => <section key={zone} aria-label={`Зона: ${zone}`} className={`min-h-32 rounded-xl border p-3 ${["border-amber-300 bg-amber-50", "border-blue-300 bg-blue-50", "border-emerald-300 bg-emerald-50", "border-stone-300 bg-stone-50"][i]}`}>
        <h3 className="mb-3 font-semibold">{zone}</h3>
        <div className="grid gap-2">{shown.filter(p => { const name = p.points.at(-1)?.zone_name; return i === 3 ? !name || !zones.includes(name) : name === zone; }).map(p => {
          const last = p.points.at(-1);
          return <button key={p.person_id} aria-pressed={focused?.person_id === p.person_id} className="rounded-lg border border-stone-300 bg-white p-3 text-left text-sm shadow-sm" onClick={() => setSelected(p.person_id)}>
            <strong className="block">● {p.full_name}</strong>
            <span className="block">{last ? demo ? "Демо" : last.source === "gps" ? "GPS" : "Симуляция с телефона" : "Нет координат за смену"}</span>
            {last && <span className="block">{time(last.at)}{stale(last) ? " · Устарело" : " · Последняя отметка"}</span>}
          </button>;
        })}</div>
      </section>)}
    </div>
    {!demo && !pending && !error && !shown.length && <p className="my-3" role="status">Открытых смен нет. Для проверки интерфейса нажмите «Попробовать демо», для живой проверки сначала пройдите КПП.</p>}
    {focused && <div className="mt-4 rounded-xl border border-stone-200 p-4">
      <h3 className="font-semibold">Последние отметки: {focused.full_name}</h3>
      {!focused.points.length ? <p className="mt-2 text-sm">Отметок ещё нет. Разрешите GPS на телефоне или выберите зону в симуляции.</p> : <ol aria-label="Последние отметки рабочего" className="mt-3 grid gap-2 text-sm">{focused.points.slice(-6).reverse().map((point, i) => <li key={`${point.at}-${i}`} className="border-b border-stone-100 pb-2">
        {time(point.at)} — {point.zone_name || "Вне известных зон"} · {demo ? "Демо" : point.source === "gps" ? "GPS" : "Симуляция с телефона"}
        {point.source === "gps" && typeof point.lat === "number" && typeof point.lng === "number" && <span className="block font-mono text-xs">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</span>}
      </li>)}</ol>}
    </div>}
    <details className="mt-4 rounded-xl bg-stone-50 p-4"><summary className="cursor-pointer font-semibold">Как проверить с настоящим телефоном</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>Заведите рабочего с фотографией в <Link className="underline" href="/admin">кадрах</Link> и выполните вход через КПП: QR → подтверждение телефоном → проверка лица.</li>
        <li>На <Link className="underline" href="/phone">телефоне рабочего</Link> оставьте страницу открытой и разрешите геолокацию. Координаты отправляются примерно раз в минуту только при открытой смене.</li>
        <li>Либо включите «Симуляцию зон» на телефоне и нажмите Бетон, Котлован, Курилка. Эти отметки сохраняются на сервере с пометкой симуляции.</li>
        <li>Здесь выберите «Реальные смены» и «Обновить местоположения» или дождитесь автообновления. Нажмите рабочего, чтобы увидеть последние отметки.</li>
        <li>Для определения зон по GPS настройте <Link className="underline" href="/admin/zones">план и зоны</Link>. Тепловая карта плана и отчёты находятся ниже; обновляйте их кнопкой «Применить».</li>
      </ol>
      <p className="mt-3 text-sm">При блокировке телефона GPS прекращается. Пустая зона не означает выход с объекта: выход подтверждается на КПП.</p>
    </details>
  </Panel>;
}
