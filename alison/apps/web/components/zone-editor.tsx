"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { API_PATHS, calibrationFrom, plansFrom, planCalibrationPayload, ZONES, zonePolygonPayload, type HeatZone, type SitePlanRecord } from "@/lib/contracts";

const PLAN_KEY = "prohodnaya:site-plan";
const PLAN_SIZE_KEY = "prohodnaya:site-plan-size";
const SHAPES_KEY = "prohodnaya:zone-shapes";
type Point = { x: number; y: number };
type Anchor = Point & { latitude: string; longitude: string };
type PlanSize = { width: number; height: number };
type SavedShapes = Record<string, Point[]>;

function readShapes(): SavedShapes {
  try {
    return JSON.parse(localStorage.getItem(SHAPES_KEY) || "{}") as SavedShapes;
  } catch {
    return {};
  }
}

export function SitePlan({ token, serverZones = [] }: { token: string; serverZones?: HeatZone[] }) {
  const [plan, setPlan] = useState("");
  const [planSize, setPlanSize] = useState<PlanSize>({ width: 0, height: 0 });
  const [plans, setPlans] = useState<SitePlanRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [shapes, setShapes] = useState<SavedShapes>({});
  const [selected, setSelected] = useState(ZONES[0].id);
  const [draft, setDraft] = useState<Point[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [drawing, setDrawing] = useState<"zone" | "anchors" | "idle">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setPlan(localStorage.getItem(PLAN_KEY) || "");
    try {
      const savedSize = JSON.parse(localStorage.getItem(PLAN_SIZE_KEY) || "null") as PlanSize | null;
      if (savedSize?.width && savedSize?.height) setPlanSize(savedSize);
    } catch {
      setPlanSize({ width: 0, height: 0 });
    }
    setShapes(readShapes());
    void api<unknown>(API_PATHS.plans, token)
      .then((value) => {
        if (!mounted) return;
        const available = plansFrom(value);
        setPlans(available);
        setSelectedPlanId(available[0]?.id || "");
        if (available[0]?.width && available[0]?.height) setPlanSize({ width: available[0].width, height: available[0].height });
      })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить планы."); });
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => {
    if (!selectedPlanId) {
      setAnchors([]);
      return;
    }
    if (!planSize.width || !planSize.height) return;
    let mounted = true;
    setError("");
    void api<unknown>(API_PATHS.planCalibration(selectedPlanId), token)
      .then((value) => {
        if (!mounted) return;
        const points = calibrationFrom(value).slice(0, 3).map((point) => ({
          x: point.pixel_x / planSize.width * 100,
          y: point.pixel_y / planSize.height * 100,
          latitude: String(point.lat),
          longitude: String(point.lon),
        }));
        setAnchors(points);
      })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить привязку плана."); });
    return () => { mounted = false; };
  }, [selectedPlanId, token, planSize.width, planSize.height]);

  useEffect(() => {
    const currentPlan = plans.find((item) => item.id === selectedPlanId);
    if (currentPlan?.width && currentPlan.height) setPlanSize({ width: currentPlan.width, height: currentPlan.height });
  }, [plans, selectedPlanId]);

  const activeZone = ZONES.find((zone) => zone.id === selected) || ZONES[0];
  const shownShapes: SavedShapes = { ...shapes };
  for (const item of serverZones) {
    if (item.zone_id && item.polygon?.length && planSize.width && planSize.height) {
      shownShapes[item.zone_id] = item.polygon.map((point) => ({
        x: Number(point.pixel_x ?? point.x) / planSize.width * 100,
        y: Number(point.pixel_y ?? point.y) / planSize.height * 100,
      }));
    }
  }

  async function choosePlan(file?: File) {
    setMessage("");
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Выберите файл изображения схемы.");
      return;
    }
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.82);
      localStorage.setItem(PLAN_KEY, data);
      const activePlan = plans.find((item) => item.id === selectedPlanId);
      const dimensions = activePlan?.width && activePlan.height
        ? { width: activePlan.width, height: activePlan.height }
        : { width: image.naturalWidth, height: image.naturalHeight };
      localStorage.setItem(PLAN_SIZE_KEY, JSON.stringify(dimensions));
      setPlanSize(dimensions);
      setPlan(data);
      setDraft([]);
      setMessage("Изображение для работы загружено в этот браузер. Выберите соответствующий план из списка перед сохранением калибровки.");
      URL.revokeObjectURL(source);
    };
    image.onerror = () => {
      setError("Не удалось прочитать изображение схемы.");
      URL.revokeObjectURL(source);
    };
    image.src = source;
  }

  function onMapClick(event: React.MouseEvent<SVGSVGElement>) {
    if (drawing === "idle") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
    if (drawing === "zone") {
      setDraft((current) => [...current, next]);
      return;
    }
    if (anchors.length >= 3) {
      setDrawing("idle");
      return;
    }
    const updated = [...anchors, { ...next, latitude: "", longitude: "" }];
    setAnchors(updated);
    if (updated.length === 3) setDrawing("idle");
  }

  function updateAnchor(index: number, key: "latitude" | "longitude", value: string) {
    setAnchors((current) => current.map((point, pointIndex) => pointIndex === index ? { ...point, [key]: value } : point));
  }

  async function saveZone() {
    setError("");
    setMessage("");
    if (draft.length < 3) {
      setError("Для границы зоны нужно отметить не меньше трёх точек.");
      return;
    }
    if (!planSize.width || !planSize.height) {
      setError("Загрузите точное изображение выбранного плана, чтобы сохранить вершины в пикселях.");
      return;
    }
    setBusy(true);
    try {
      await api(API_PATHS.zonePolygon(activeZone.id), token, {
        method: "PUT",
        body: JSON.stringify(zonePolygonPayload(
          draft.map(({ x, y }) => ({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) })),
          planSize.width,
          planSize.height,
        )),
      });
      const next = { ...shapes, [activeZone.id]: draft };
      localStorage.setItem(SHAPES_KEY, JSON.stringify(next));
      setShapes(next);
      setDraft([]);
      setDrawing("idle");
      setMessage("Граница зоны сохранена на сервере.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить границу зоны.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCalibration() {
    setError("");
    setMessage("");
    if (!selectedPlanId) {
      setError("Сначала выберите план, полученный из API.");
      return;
    }
    if (!planSize.width || !planSize.height) {
      setError("Откройте изображение выбранного плана, чтобы перевести точки в пиксели.");
      return;
    }
    if (anchors.length !== 3 || anchors.some((point) => !point.latitude.trim() || !point.longitude.trim())) {
      setError("Укажите на плане три контрольные точки и координаты каждой.");
      return;
    }
    const valid = anchors.every((point) => {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    });
    if (!valid) {
      setError("Широта должна быть от −90 до 90, долгота — от −180 до 180.");
      return;
    }
    setBusy(true);
    try {
      await api(API_PATHS.planCalibration(selectedPlanId), token, {
        method: "PUT",
        body: JSON.stringify(planCalibrationPayload(anchors.map(({ x, y, latitude, longitude }) => ({
          x: Number((x / 100 * planSize.width).toFixed(2)),
          y: Number((y / 100 * planSize.height).toFixed(2)),
          latitude: Number(latitude),
          longitude: Number(longitude),
        })))),
      });
      setMessage("Три точки привязки сохранены для выбранного плана.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить привязку плана.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="zone-editor">
      <div className="zone-editor-head">
        <div><h2>Схема площадки</h2><p>Выберите план из API. Изображение можно открыть в этом браузере для разметки.</p></div>
        <label className="button button-secondary upload-button">Открыть изображение плана<input type="file" accept="image/*" onChange={(event) => void choosePlan(event.target.files?.[0])} /></label>
      </div>
      <label className="field plan-select"><span>План из API</span><select value={selectedPlanId} onChange={(event) => { const nextId = event.target.value; const nextPlan = plans.find((item) => item.id === nextId); setSelectedPlanId(nextId); setPlanSize(nextPlan?.width && nextPlan.height ? { width: nextPlan.width, height: nextPlan.height } : { width: 0, height: 0 }); setDraft([]); setDrawing("idle"); }}><option value="">{plans.length ? "Выберите план" : "Планы не найдены"}</option>{plans.map((item) => <option value={item.id} key={item.id}>{item.name || item.id}</option>)}</select><small>Калибровка и полигоны сохраняются отдельно; координаты отправляются в пикселях изображения.</small></label>
      <div className="zone-picker">
        {ZONES.map((zone) => (
          <button key={zone.id} className={selected === zone.id ? "zone-chip selected" : "zone-chip"} onClick={() => { setSelected(zone.id); setDraft([]); }}>
            <span className="zone-chip-dot" style={{ background: zone.id === "beton" ? "#d99435" : zone.id === "kotlovan" ? "#6482d7" : "#4d9a78" }} />
            {zone.name}<small>{zone.camera}</small>
          </button>
        ))}
      </div>
      <div className="editor-grid">
        <div className="editor-canvas-wrap">
          {plan ? (
            <svg className="site-canvas" viewBox="0 0 100 100" preserveAspectRatio="none" onClick={onMapClick} role="img" aria-label="План площадки с границами зон">
              <image href={plan} x="0" y="0" width="100" height="100" preserveAspectRatio="none" />
              <rect x="0" y="0" width="100" height="100" fill="rgba(16, 31, 27, .12)" />
              {Object.entries(shownShapes).map(([id, points]) => points.length > 2 ? (
                <polygon key={id} points={points.map((point) => point.x + "," + point.y).join(" ")} fill={id === "beton" ? "rgba(217,148,53,.3)" : id === "kotlovan" ? "rgba(100,130,215,.3)" : "rgba(77,154,120,.3)"} stroke={id === "beton" ? "#d99435" : id === "kotlovan" ? "#6482d7" : "#4d9a78"} strokeWidth=".6" vectorEffect="non-scaling-stroke" />
              ) : null)}
              {draft.length > 0 && <polygon points={draft.map((point) => point.x + "," + point.y).join(" ")} fill="rgba(217,148,53,.24)" stroke="#d99435" strokeWidth=".7" vectorEffect="non-scaling-stroke" />}
              {draft.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r=".9" fill="#fff" stroke="#d99435" strokeWidth=".5" vectorEffect="non-scaling-stroke" />)}
              {anchors.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="1.6" fill="#163c31" stroke="#fff" strokeWidth=".5" vectorEffect="non-scaling-stroke" /><text x={point.x + 1.8} y={point.y - 1.3} fill="#163c31" fontSize="3">Т{index + 1}</text></g>)}
            </svg>
          ) : (
            <div className="plan-empty">
              <div className="plan-empty-icon">⌖</div>
              <strong>План ещё не загружен</strong>
              <p>Откройте изображение выбранного плана. Кадры отдельных камер не заменяют общую схему участка.</p>
              <label className="button button-primary upload-button">Выбрать изображение<input type="file" accept="image/*" onChange={(event) => void choosePlan(event.target.files?.[0])} /></label>
            </div>
          )}
        </div>
        <aside className="editor-tools">
          <div className="tool-selected"><span className="zone-chip-dot" style={{ background: activeZone.id === "beton" ? "#d99435" : activeZone.id === "kotlovan" ? "#6482d7" : "#4d9a78" }} /><div><strong>{activeZone.name}</strong><small>{activeZone.camera} · {shownShapes[activeZone.id]?.length ? "граница сохранена" : "граница не задана"}</small></div></div>
          <div className="tool-actions">
            <button className={drawing === "zone" ? "button button-primary" : "button button-secondary"} disabled={!plan} onClick={() => { setDraft([]); setDrawing(drawing === "zone" ? "idle" : "zone"); }}>Нарисовать границу</button>
            <button className={drawing === "anchors" ? "button button-primary" : "button button-secondary"} disabled={!plan || !selectedPlanId || !planSize.width || !planSize.height} onClick={() => { setAnchors([]); setDrawing(drawing === "anchors" ? "idle" : "anchors"); }}>Поставить 3 точки</button>
          </div>
          <p className="muted small">Нажмите на план, чтобы добавить вершины полигона или поставить точки калибровки. Изображение хранится только в этом браузере.</p>
          <div className="anchor-list">
            <div className="anchor-list-head"><b>Опорные координаты</b><span>{anchors.length}/3</span></div>
            {anchors.map((point, index) => (
              <div className="anchor-row" key={index}><span className="anchor-number">Т{index + 1}</span><input type="number" step="any" aria-label={"Широта точки " + (index + 1)} placeholder="Широта" value={point.latitude} onChange={(event) => updateAnchor(index, "latitude", event.target.value)} /><input type="number" step="any" aria-label={"Долгота точки " + (index + 1)} placeholder="Долгота" value={point.longitude} onChange={(event) => updateAnchor(index, "longitude", event.target.value)} /></div>
            ))}
            {!anchors.length && <div className="anchor-empty">Поставьте три точки на схеме, затем добавьте координаты.</div>}
          </div>
          {error && <div className="notice notice-error">{error}</div>}
          {message && <div className="notice notice-success">{message}</div>}
          <div className="tool-footer"><button className="button button-primary" disabled={!plan || !planSize.width || !planSize.height || busy} onClick={() => void saveZone()}>{busy ? "Сохраняем…" : "Сохранить полигон"}</button><button className="button button-secondary" disabled={!selectedPlanId || !plan || !planSize.width || !planSize.height || busy} onClick={() => void saveCalibration()}>{busy ? "Сохраняем…" : "Сохранить 3 точки плана"}</button><button className="button button-quiet" onClick={() => { setDraft([]); setDrawing("idle"); }}>Сбросить контур</button></div>
        </aside>
      </div>
      <div className="zone-reference-grid">
        {ZONES.map((zone) => <article className="reference-card" key={zone.id}><img src={zone.image} alt={"Кадр зоны " + zone.name} /><div><b>{zone.name}</b><span>{zone.camera}</span></div></article>)}
      </div>
      <p className="muted tiny">Кадры камер помогают сверить названия зон. Они не заменяют общую схему площадки.</p>
    </div>
  );
}
