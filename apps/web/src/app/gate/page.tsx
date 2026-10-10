"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useAttemptStatus } from "@/hooks/use-attempt-status";
import { imageFileToFrame } from "@/lib/image-frame";
import { CameraPreview, type FaceBox } from "@/components/camera-preview";
import { ScreenShell, Status } from "@/components/screen-shell";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, errorMessage, type Attempt, type Decision } from "@/lib/pass-api";

export default function GatePage() {
  const auth = useAuth();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const active = useRef<Attempt | null>(null);
  const operation = useRef(0);
  const lock = useRef(false);
  const allowed = auth.authenticated && auth.roles.includes("gate");
  const expired = attempt ? now >= Date.parse(attempt.expires_at) : false;
  const journal = useAttemptStatus(allowed ? attempt?.attempt_id || null : null, auth.subject, auth.token);
  const phoneConfirmed = journal.confirmed && journal.fresh;
  const canCapture = allowed && phoneConfirmed && Boolean(attempt) && !expired && !decision && !busy && !uncertain;
  const canPreview = allowed && !expired && !decision && !busy && !uncertain;
  const cameraDisabledReason = !allowed ? "Войдите в учётную запись контролёра, чтобы включить камеру."
    : expired ? "Срок попытки истёк. Откройте новый QR."
      : uncertain ? "Дождитесь серверного результата предыдущей попытки."
        : decision ? "Попытка завершена. Для следующего рабочего откройте новый QR."
          : "Дождитесь завершения запроса.";

  useEffect(() => {
    if (!journal.decision || (decision?.decision === journal.decision.decision && (decision.reason_human || decision.reason) === journal.decision.reason)) return;
    setUncertain(false); setDecision(journal.decision); setFrame(null); setQr(null); active.current = null;
  }, [journal.decision, decision]);

  useEffect(() => {
    if (!attempt || decision) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [attempt, decision]);

  async function openAttempt() {
    if (lock.current || !allowed) return;
    lock.current = true; setBusy(true); setUncertain(false); setMessage(null); setDecision(null); setFrame(null); setQr(null);
    const version = ++operation.current;
    try {
      const accessToken = await auth.token();
      const old = active.current;
      if (old) await apiRequest(`/attempts/${old.attempt_id}/cancel`, accessToken, {});
      active.current = null; setAttempt(null);
      const created = await apiRequest<Attempt>("/attempts", accessToken, { direction });
      if (version !== operation.current) {
        await apiRequest(`/attempts/${created.attempt_id}/cancel`, accessToken, {}, true);
        return;
      }
      if (!created.attempt_id || !created.nonce || !Number.isFinite(Date.parse(created.expires_at))) throw new Error("Сервер вернул некорректную попытку.");
      active.current = created; setAttempt(created); setNow(Date.now());
      const url = new URL("/phone", location.origin);
      url.hash = new URLSearchParams({ attempt: created.attempt_id, nonce: created.nonce }).toString();
      const image = await QRCode.toDataURL(url.toString(), { width: 280, margin: 4, errorCorrectionLevel: "M" });
      if (version === operation.current) setQr(image);
    } catch (error) { if (version === operation.current) setMessage(errorMessage(error)); }
    finally { if (version === operation.current) { lock.current = false; setBusy(false); } }
  }

  async function closeAttempt() {
    if (lock.current) return;
    const old = active.current;
    ++operation.current;
    active.current = null; setAttempt(null); setQr(null); setFrame(null); setDecision(null);
    if (!old) return;
    lock.current = true; setBusy(true);
    try {
      await apiRequest(`/attempts/${old.attempt_id}/cancel`, await auth.token(), {});
      setMessage("Попытка отменена сервером.");
    } catch (error) { setMessage(`${errorMessage(error)} QR скрыт; при потере связи сервер ограничивает попытку её сроком.`); }
    finally { lock.current = false; setBusy(false); }
  }

  async function decide() {
    if (!attempt || !frame || expired || lock.current || !allowed || !phoneConfirmed || uncertain) return;
    lock.current = true; setBusy(true); setMessage(null);
    const version = operation.current;
    try {
      const result = await apiRequest<Decision>(`/attempts/${attempt.attempt_id}/decide`, await auth.token(), { nonce: attempt.nonce, image_base64: frame });
      if (version !== operation.current) return;
      if (result.decision !== "allow" && result.decision !== "deny") throw new Error("Результат проверки неизвестен. Обратитесь к контролёру.");
      setDecision(result); setFrame(null); setQr(null);
      active.current = null;
    } catch (error) { if (version === operation.current) { setUncertain(true); setFrame(null); setMessage(`${errorMessage(error)} Читаем итог с сервера; повторная отправка заблокирована.`); } }
    finally { if (version === operation.current) { lock.current = false; setBusy(false); } }
  }

  async function locateLiveFace(image: string): Promise<FaceBox[]> {
    try {
      const result = await apiRequest<{ boxes?: FaceBox[] }>("/attempts/face-boxes", await auth.token(), { image_base64: image });
      return Array.isArray(result.boxes) ? result.boxes : [];
    } catch {
      return [];
    }
  }

  return <ScreenShell role="gate" title="Контроль прохода" description="Выберите направление и откройте попытку для рабочего.">
    {decision && <section className="gate-outcome" role={decision.decision === "deny" ? "alert" : undefined}><Status tone={decision.decision === "deny" ? "error" : "neutral"} title={decision.decision === "allow" ? "Проход разрешён сервером" : "Проход не разрешён"}>{decision.reason_human || decision.reason}</Status></section>}
    <div className="gate-grid">
      <section className="panel">
        <div className="section-heading"><h2>Попытка прохода</h2><span className="badge">{busy ? "Запрос…" : "Серверный QR"}</span></div>
        <fieldset className="direction-picker" disabled={busy || Boolean(attempt && !decision && !expired)}>
          <legend>Направление</legend>
          <label><input type="radio" name="direction" checked={direction === "in"} onChange={() => setDirection("in")} /><span>Вход на объект</span></label>
          <label><input type="radio" name="direction" checked={direction === "out"} onChange={() => setDirection("out")} /><span>Выход с объекта</span></label>
        </fieldset>
        <div className="qr-stage">
          {qr && !expired && !decision ? <img className="qr-image" src={qr} alt="Одноразовый QR для телефона рабочего" width={280} height={280} /> : <span className="qr-outline" aria-hidden="true">QR</span>}
          <strong>{expired && !decision ? "Срок QR истёк" : qr && !decision ? "Рабочий сканирует этот QR" : "Откройте попытку"}</strong>
          {attempt && !decision && !expired && <p>Осталось {Math.max(0, Math.ceil((Date.parse(attempt.expires_at) - now) / 1000))} с. Направление: {attempt.direction === "in" ? "вход" : "выход"}.</p>}
        </div>
        <div className="button-row">
          <button className="button" disabled={!allowed || busy} onClick={openAttempt}>{attempt ? "Открыть новый QR" : "Открыть QR"}</button>
          {attempt && <button className="button button-secondary" disabled={busy} onClick={closeAttempt}>Закрыть QR</button>}
        </div>
        <p className="hint">Скрытие вкладки попытку не отменяет. Отмена только кнопкой «Закрыть QR». Если сеть пропала, попытка живёт до серверного срока.</p>
      </section>
      <CameraPreview enabled={canPreview} disabledReason={cameraDisabledReason} key={attempt?.attempt_id || "idle"} title="Камера КПП" description={canCapture ? "Телефон подтвердил попытку. Жёлтая рамка — камера видит лицо. Снимите этот же кадр и отправьте его на проверку." : "Предпросмотр можно включить заранее. Жёлтая рамка показывает, что камера видит лицо. Кнопка «Снять кадр» появится после подтверждения QR рабочим на телефоне."} locateFaces={allowed ? locateLiveFace : undefined} onCapture={canCapture ? setFrame : undefined} />
    </div>
    <section className="panel result-panel">
      <label className="file-label">Загрузить кадр JPEG / PNG
        <input className="file-input" aria-label="Загрузить кадр JPEG / PNG" type="file" accept="image/jpeg,image/png" disabled={!canCapture} onChange={async (event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          const version = operation.current;
          try { const loaded = await imageFileToFrame(file); if (version === operation.current && active.current?.attempt_id === attempt?.attempt_id && Date.now() < Date.parse(attempt?.expires_at || "")) setFrame(loaded); }
          catch (error) { if (version === operation.current) setMessage(errorMessage(error)); }
        }} />
      </label>
      <p className="hint">Для проверки материалов пакета или ошибки камеры. Фото не заменяет проверку живого лица на сервере.</p>
      <div className="section-heading"><h2>Проверка сервером</h2><span className="badge">{frame ? "Кадр готов" : "Нет кадра"}</span></div>
      {frame && <img className="captured-frame" src={frame} alt="Кадр текущей попытки перед отправкой" />}
      {!decision && <Status tone={attempt ? "waiting" : "neutral"} title={uncertain ? "Результат пока неизвестен" : busy ? "Выполняется запрос" : phoneConfirmed ? "Телефон подтвердил попытку" : attempt ? "Подтверждение рабочего ожидается" : "Нет активной попытки"}>Подтверждение читается с сервера. Кадр доступен после подтверждения; решение принимает сервер.</Status>}
      {journal.error && <p className="inline-error" role="alert">{journal.error} Подтверждение временно недоступно.</p>}
      {message && <p className="inline-error" role="alert">{message}</p>}
      <button className="button capture-button" disabled={!canCapture || !frame} onClick={decide}>Отправить кадр на проверку</button>
    </section>
  </ScreenShell>;
}
