"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/shell";
import { SitePlan, type PlanShape } from "@/components/site-plan";
import { apiRequest, asArray, offlineReason, serverReason } from "@/lib/api";
import {
  loadPlanImage,
  readImageFile,
  readRing,
  ringToPixels,
  savePlanImage,
  zoneLook,
  type CalibrationPoint,
  type Plan,
  type PlanImage,
  type Zone,
} from "@/lib/site";

type Anchor = { pixel_x: number; pixel_y: number; lat: string; lon: string };
type Mode = "idle" | "anchors" | "zone";

export function ZoneEditor({ token }: { token: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [image, setImage] = useState<PlanImage | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [draft, setDraft] = useState<Array<{ x: number; y: number }>>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadZones = useCallback(async () => {
    const response = await apiRequest("/analytics/heat", "GET", token);
    if (response.status !== 200) return;
    const rows = asArray<Record<string, unknown>>(response.json, "zones").map((row) => ({
      id: String(row.id),
      name: String(row.name),
      photo_id: typeof row.photo_id === "string" ? row.photo_id : null,
      polygon: readRing(row.polygon),
      visits: Number(row.visits ?? 0),
      empty: Boolean(row.empty),
    }));
    setZones(rows);
    setZoneId((current) => current || rows[0]?.id || "");
  }, [token]);

  useEffect(() => {
    void (async () => {
      const response = await apiRequest("/plans", "GET", token);
      if (response.offline) {
        setPlans([]);
        setError(offlineReason);
        return;
      }
      if (response.status !== 200) {
        setPlans([]);
        setError(serverReason(response.json, "Планы не загрузились."));
        return;
      }
      const list = asArray<Plan>(response.json, "plans");
      setPlans(list);
      setPlanId(list[0]?.id ?? "");
    })();
    void loadZones();
  }, [token, loadZones]);

  useEffect(() => {
    const plan = plans?.find((item) => item.id === planId);
    setImage(planId ? loadPlanImage(planId) : null);
    setAnchors((plan?.points ?? []).map((p) => ({ pixel_x: p.pixel_x, pixel_y: p.pixel_y, lat: String(p.lat), lon: String(p.lon) })));
    setDraft([]);
    setMode("idle");
  }, [plans, planId]);

  const savedPoints: CalibrationPoint[] = plans?.find((item) => item.id === planId)?.points ?? [];
  const calibrated = savedPoints.length === 3;
  const zone = zones.find((item) => item.id === zoneId);

  async function chooseImage(file?: File) {
    setError(null);
    setSaved(null);
    if (!file || !planId) return;
    try {
      const next = await readImageFile(file);
      if (!savePlanImage(planId, next)) {
        setError("Изображение слишком большое для хранилища браузера. Уменьшите файл.");
        return;
      }
      setImage(next);
      setSaved("План открыт в этом браузере. Если изображение новое, заново поставьте три точки привязки.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Изображение не прочиталось.");
    }
  }

  function pick(point: { x: number; y: number }) {
    if (mode === "zone") {
      setDraft((current) => [...current, point]);
      return;
    }
    if (mode === "anchors") {
      setAnchors((current) => {
        const next = [...current, { pixel_x: point.x, pixel_y: point.y, lat: "", lon: "" }].slice(0, 3);
        if (next.length === 3) setMode("idle");
        return next;
      });
    }
  }

  async function saveCalibration() {
    setError(null);
    setSaved(null);
    const points = anchors.map((a) => ({ pixel_x: a.pixel_x, pixel_y: a.pixel_y, lat: Number(a.lat), lon: Number(a.lon) }));
    if (points.length !== 3 || anchors.some((a) => !a.lat.trim() || !a.lon.trim())) {
      setError("Поставьте на плане три точки и введите координаты каждой.");
      return;
    }
    if (points.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
      setError("Широта от −90 до 90, долгота от −180 до 180.");
      return;
    }
    setPending(true);
    const response = await apiRequest(`/plans/${planId}/calibration`, "PUT", token, { points });
    setPending(false);
    if (response.offline) return setError(offlineReason);
    if (response.status !== 200) return setError(serverReason(response.json, "Привязка не сохранена."));
    setPlans((current) => current?.map((plan) => (plan.id === planId ? { ...plan, points } : plan)) ?? null);
    setSaved(serverReason(response.json, "Точки привязки сохранены."));
  }

  async function saveZone() {
    setError(null);
    setSaved(null);
    if (!zone) return;
    if (draft.length < 3) return setError("Для границы зоны нужно не меньше трёх точек.");
    const ring = draft.map((p) => [p.x, p.y]);
    setPending(true);
    const response = await apiRequest(`/zones/${zone.id}/polygon`, "PUT", token, { polygon: ring });
    setPending(false);
    if (response.offline) return setError(offlineReason);
    if (response.status !== 200) return setError(serverReason(response.json, "Граница не сохранена."));
    setDraft([]);
    setMode("idle");
    setSaved(serverReason(response.json, "Граница зоны сохранена."));
    await loadZones();
  }

  const shapes: PlanShape[] = zones.flatMap((item) => {
    const points = ringToPixels(item.polygon);
    if (!points) return [];
    const look = zoneLook(item.name);
    return [{ id: item.id, points, fill: look.color, stroke: look.color, label: item.name }];
  });
  if (draft.length) shapes.push({ id: "draft", points: draft, fill: "#d99435", stroke: "#b45309", opacity: 0.25 });

  if (plans === null) return <Panel title="План и зоны"><p className="text-sm text-stone-600">Загружаем планы…</p></Panel>;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel
        title="Схема площадки"
        aside={
          <label className="cursor-pointer rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold">
            {image ? "Заменить изображение" : "Открыть изображение плана"}
            <input className="sr-only" type="file" accept="image/*" disabled={!planId} onChange={(event) => void chooseImage(event.target.files?.[0])} />
          </label>
        }
      >
        {plans.length > 1 ? (
          <label className="mb-3 block text-sm font-medium">
            План
            <select className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" value={planId} onChange={(event) => setPlanId(event.target.value)}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {!planId ? <p className="text-sm text-stone-600">Сервер не вернул ни одного плана.</p> : null}
        {planId && !image ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-stone-300 px-4 py-12 text-center">
            <strong>План ещё не открыт в этом браузере</strong>
            <p className="mt-1 max-w-sm text-sm text-stone-600">Загрузите общую схему участка. Кадры камер ниже помогают сверить зоны, но не заменяют схему.</p>
          </div>
        ) : null}
        {image ? (
          <SitePlan image={image} shapes={shapes} onPick={mode === "idle" ? undefined : pick}>
            {anchors.map((a, index) => (
              <g key={index}>
                <circle cx={a.pixel_x} cy={a.pixel_y} r={Math.max(image.width, image.height) / 90} fill="#163c31" stroke="#fff" strokeWidth={2} />
                <text x={a.pixel_x + 14} y={a.pixel_y - 10} fontSize={Math.max(image.width, image.height) / 40} fill="#163c31" stroke="#fff" strokeWidth={3} paintOrder="stroke">Т{index + 1}</text>
              </g>
            ))}
          </SitePlan>
        ) : null}
        <p className="mt-2 text-xs text-stone-500">Изображение плана хранится только в этом браузере. Точки привязки и границы зон сохраняет сервер.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {zones.map((item) => {
            const look = zoneLook(item.name);
            return look.photo ? (
              <figure key={item.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <img src={look.photo} alt={`Кадр зоны ${item.name}`} className="aspect-video w-full object-cover" />
                <figcaption className="px-2 py-1 text-xs"><b>{item.name}</b> · {look.camera}</figcaption>
              </figure>
            ) : null;
          })}
        </div>
      </Panel>
      <div className="grid content-start gap-4">
        <Panel title="1. Привязка плана">
          <p className="mb-3 text-sm text-stone-600">Три точки на плане с известными GPS-координатами. Не на одной прямой.</p>
          <button
            type="button"
            className={`min-h-11 w-full rounded-xl px-3 font-semibold ${mode === "anchors" ? "bg-emerald-900 text-white" : "border border-stone-300"}`}
            disabled={!image}
            onClick={() => { setAnchors([]); setMode(mode === "anchors" ? "idle" : "anchors"); }}
          >
            {mode === "anchors" ? `Нажмите на план: ${anchors.length}/3` : "Поставить 3 точки"}
          </button>
          <div className="mt-3 grid gap-2">
            {anchors.map((a, index) => (
              <div key={index} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2 text-sm">
                <b>Т{index + 1}</b>
                <input className="min-w-0 rounded-lg border border-stone-300 px-2 py-2" inputMode="decimal" placeholder="Широта" aria-label={`Широта точки ${index + 1}`} value={a.lat} onChange={(event) => setAnchors((cur) => cur.map((p, i) => (i === index ? { ...p, lat: event.target.value } : p)))} />
                <input className="min-w-0 rounded-lg border border-stone-300 px-2 py-2" inputMode="decimal" placeholder="Долгота" aria-label={`Долгота точки ${index + 1}`} value={a.lon} onChange={(event) => setAnchors((cur) => cur.map((p, i) => (i === index ? { ...p, lon: event.target.value } : p)))} />
              </div>
            ))}
          </div>
          <button type="button" className="mt-3 min-h-11 w-full rounded-xl bg-emerald-900 px-3 font-semibold text-white" disabled={pending || anchors.length !== 3} onClick={() => void saveCalibration()}>
            Сохранить привязку
          </button>
          <p className="mt-2 text-xs text-stone-500">{calibrated ? "Привязка на сервере есть." : "Привязки на сервере нет."}</p>
        </Panel>
        <Panel title="2. Граница зоны">
          <div className="mb-3 flex flex-wrap gap-2">
            {zones.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm ${zoneId === item.id ? "border-emerald-900 bg-emerald-50 font-semibold" : "border-stone-300"}`}
                onClick={() => { setZoneId(item.id); setDraft([]); }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: zoneLook(item.name).color }} />
                {item.name}
              </button>
            ))}
          </div>
          {zone ? <p className="mb-3 text-xs text-stone-500">{zone.polygon ? "Граница сохранена, новая заменит её." : "Граница не задана."}</p> : null}
          <button
            type="button"
            className={`min-h-11 w-full rounded-xl px-3 font-semibold ${mode === "zone" ? "bg-emerald-900 text-white" : "border border-stone-300"}`}
            disabled={!image}
            onClick={() => { setDraft([]); setMode(mode === "zone" ? "idle" : "zone"); }}
          >
            {mode === "zone" ? `Вершин: ${draft.length}` : "Нарисовать границу"}
          </button>
          <div className="mt-2 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-xl bg-emerald-900 px-3 font-semibold text-white" disabled={pending || draft.length < 3} onClick={() => void saveZone()}>
              Сохранить
            </button>
            <button type="button" className="min-h-11 rounded-xl border border-stone-300 px-3" onClick={() => { setDraft([]); setMode("idle"); }}>
              Сбросить
            </button>
          </div>
          {!calibrated && image ? <p className="mt-2 text-xs text-stone-500">Без привязки плана GPS не попадёт в зону; кнопки зон на телефоне работают и так.</p> : null}
        </Panel>
        {error ? <Notice tone="bad" title="Не сохранено">{error}</Notice> : null}
        {saved ? <Notice tone="ok" title="Готово">{saved}</Notice> : null}
      </div>
    </div>
  );
}
