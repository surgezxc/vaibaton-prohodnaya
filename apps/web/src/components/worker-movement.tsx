"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Status } from "@/components/screen-shell";
import { apiRequest, errorMessage } from "@/lib/pass-api";

type Me = { person: { id: string; full_name: string }; shift: { shift_id: string; started_at: string } | null };
type LocationResult = { location_id: string; shift_id: string; recorded_at: string; reason_human: string };

export function WorkerMovement({ revision }: { revision: string | null }) {
  const auth = useAuth();
  const enabled = auth.authenticated && auth.roles.includes("worker");
  const identity = enabled ? auth.subject : null;
  const token = useRef(auth.token); token.current = auth.token;
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"gps" | "button" | "off">("gps");
  const [retry, setRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<{ time: string; accuracy?: number; source: "gps" | "button"; lat?: number; lng?: number; zone?: string } | null>(null);
  const version = useRef(0);
  const zoneLock = useRef(false);
  const lastGps = useRef(0);
  const currentShift = useRef<string | null>(null);

  useEffect(() => { setMe(null); setLast(null); setMessage(null); lastGps.current = 0; currentShift.current = null; }, [identity]);

  useEffect(() => {
    const generation = ++version.current;
    let stopped = false;
    let reading = false;
    let denied = false;
    let timer: ReturnType<typeof setTimeout>;
    const valid = () => !stopped && version.current === generation && !document.hidden;
    async function tick() {
      if (!identity || !valid() || reading) return;
      reading = true;
      try {
        const state = await apiRequest<Me>("/me", await token.current());
        if (!state.person?.id || (state.shift !== null && (!state.shift?.shift_id || !Number.isFinite(Date.parse(state.shift.started_at))))) throw new Error("Сервер не вернул состояние смены.");
        if (!valid()) return;
        if (currentShift.current !== state.shift?.shift_id) setLast(null);
        currentShift.current = state.shift?.shift_id || null;
        setMe(state); if (!denied) setError(null);
        if (!state.shift || mode !== "gps" || denied || Date.now() - lastGps.current < 60000) return;
        if (!navigator.geolocation) throw new Error("Геолокация недоступна. Откройте страницу по HTTPS.");
        const shiftId = state.shift.shift_id;
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }));
        if (!valid() || currentShift.current !== shiftId) return;
        // Проверяем смену ещё раз после ожидания датчика; сервер проверяет её под блокировкой.
        const fresh = await apiRequest<Me>("/me", await token.current());
        if (!valid()) return;
        setMe(fresh); currentShift.current = fresh.shift?.shift_id || null;
        if (fresh.shift?.shift_id !== shiftId) return;
        const accessToken = await token.current();
        if (!valid()) return;
        lastGps.current = Date.now();
        const saved = await apiRequest<LocationResult>("/locations", accessToken, { source: "gps", shift_id: shiftId, lat: position.coords.latitude, lng: position.coords.longitude });
        if (!valid()) return;
        if (!saved.location_id || saved.shift_id !== shiftId) throw new Error("Сервер не подтвердил запись координат.");
        setLast({ time: saved.recorded_at, accuracy: position.coords.accuracy, source: "gps", lat: position.coords.latitude, lng: position.coords.longitude }); setMessage("Координаты записаны сервером.");
      } catch (cause) {
        if (!valid()) return;
        if (typeof cause === "object" && cause !== null && "code" in cause) {
          denied = cause.code === 1;
          setError(denied ? "Доступ к геолокации запрещён. Разрешите его в браузере и нажмите «Повторить»." : "Не удалось определить местоположение. Следующая попытка через 60 секунд.");
        } else { setMe(null); currentShift.current = null; setError(errorMessage(cause)); }
      } finally {
        reading = false;
        if (valid()) timer = setTimeout(tick, 60000);
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) { ++version.current; setMe(null); currentShift.current = null; }
      else setRetry((v) => v + 1);
    }
    document.addEventListener("visibilitychange", visibility);
    void tick();
    return () => { stopped = true; ++version.current; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [identity, mode, retry, revision]);

  async function zone(name: string) {
    if (!identity || mode !== "button" || !me?.shift || zoneLock.current || document.hidden) return;
    zoneLock.current = true; setSending(true); setMessage(null);
    const generation = version.current;
    const shiftId = me.shift.shift_id;
    try {
      const fresh = await apiRequest<Me>("/me", await token.current());
      if (generation !== version.current || document.hidden) return;
      setMe(fresh); currentShift.current = fresh.shift?.shift_id || null;
      if (fresh.shift?.shift_id !== shiftId) throw new Error("Смена изменилась. Выберите зону снова после обновления.");
      const accessToken = await token.current();
      if (generation !== version.current || document.hidden) return;
      const saved = await apiRequest<LocationResult>("/locations", accessToken, { source: "button", shift_id: shiftId, zone_name: name });
      if (generation !== version.current || document.hidden) return;
      if (!saved.location_id || saved.shift_id !== shiftId) throw new Error("Сервер не подтвердил запись зоны.");
      setLast({ time: saved.recorded_at, source: "button", zone: name });
      setMessage(`Симуляция: ${name}. ${saved.reason_human}`); setError(null);
    } catch (cause) { if (generation === version.current) { setError(errorMessage(cause)); setMe(null); currentShift.current = null; setRetry((v) => v + 1); } }
    finally { zoneLock.current = false; setSending(false); }
  }

  return <>
    <section className="panel">
      <div className="section-heading"><h2>Моя смена</h2><span className="badge">{me?.shift ? "Открыта" : me ? "Закрыта" : "Нет данных"}</span></div>
      <Status title={me?.shift ? "Вы на объекте" : me ? "Открытой смены нет" : "Состояние смены неизвестно"}>{me?.shift ? `${me.person.full_name}. Начало: ${new Date(me.shift.started_at).toLocaleString("ru-RU")}.` : me ? "Геолокация и кнопки зон отключены. Вход подтверждает сервер после проверки лица." : "Войдите как рабочий. При отсутствии связи координаты не запрашиваются."}</Status>
      <button className="button button-secondary" disabled={!identity || sending} onClick={() => setRetry((v) => v + 1)}>Обновить смену / Повторить</button>
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Местоположение</h2><span className="badge">{mode === "gps" ? "Раз в 60 секунд" : "GPS выключен"}</span></div>
      <p className="muted">GPS работает только при открытой смене и видимой странице. В фоне и при блокировке телефона отправка прекращается. Используется экономный режим, без постоянного наблюдения за датчиком.</p>
      <div className="button-row"><button className="button button-secondary" disabled={mode === "gps" || sending} onClick={() => setMode("gps")}>Включить GPS</button><button className="button button-secondary" disabled={mode === "off" || sending} onClick={() => setMode("off")}>Остановить</button></div>
      <div className="hint" role="status">
        <strong>{last ? "Сервер принял местоположение" : "В этой смене ещё нет подтверждённой отправки с этой страницы"}</strong>
        {last && <p>Источник: {last.source === "gps" ? "GPS" : `Симуляция — ${last.zone}`}. Время: {new Date(last.time).toLocaleTimeString("ru-RU")}.
          {last.source === "gps" && <> Координаты: {last.lat?.toFixed(6)}, {last.lng?.toFixed(6)}. Точность: ±{Math.round(last.accuracy ?? 0)} м.</>}</p>}
        <p>Руководитель видит отметки в разделе «Местоположение рабочих» на странице <a href="/manager">«Руководитель»</a>. После отправки обновите данные там или дождитесь автоматического обновления.</p>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {message && <p className="hint" role="status">{message}</p>}
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Симуляция зон</h2><span className="badge">{mode === "button" ? "Включена" : "Выключена"}</span></div>
      <p className="muted">Кнопки отмечают зону вручную для демонстрации. В режиме симуляции GPS выключен.</p>
      <button className="button button-secondary" disabled={!identity || mode === "button" || sending} onClick={() => setMode("button")}>Включить симуляцию</button>
      <div className="zone-buttons">{["Бетон", "Котлован", "Курилка"].map((name) => <button key={name} className="button button-secondary" disabled={!me?.shift || mode !== "button" || sending} onClick={() => void zone(name)}>{name}</button>)}</div>
    </section>
  </>;
}
