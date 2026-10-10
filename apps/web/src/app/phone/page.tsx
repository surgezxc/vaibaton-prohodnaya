"use client";

import { useEffect, useRef, useState } from "react";
import { WorkerMovement } from "@/components/worker-movement";
import { useAttemptStatus } from "@/hooks/use-attempt-status";
import { CameraPreview } from "@/components/camera-preview";
import { ScreenShell, Status } from "@/components/screen-shell";
import { useAuth } from "@/components/auth-provider";
import { keycloakBase } from "@/lib/config";
import { apiRequest, errorMessage } from "@/lib/pass-api";
import { generateProof, storedProof, signNonce, parseAttempt, type QrAttempt, type StoredProof } from "@/lib/phone-proof";

export default function PhonePage() {
  const auth = useAuth();
  const [proof, setProof] = useState<StoredProof | null>(null);
  const [attempt, setAttempt] = useState<QrAttempt | null>(null);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [tracked, setTracked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const allowed = auth.authenticated && auth.roles.includes("worker");
  const result = useAttemptStatus(allowed ? tracked : null, auth.subject, auth.token);
  const owner = auth.subject ? `${keycloakBase()}|${process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "prohodnaya"}|${auth.subject}` : null;

  useEffect(() => {
    try {
      const text = location.hash.includes("attempt=") ? location.href : sessionStorage.getItem("prohodnaya-pending-qr");
      if (text) {
        const parsed = parseAttempt(text, location.origin);
        setAttempt(parsed);
        sessionStorage.setItem("prohodnaya-pending-qr", text);
        history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (error) { setMessage(errorMessage(error)); sessionStorage.removeItem("prohodnaya-pending-qr"); }
  }, []);

  useEffect(() => {
    let disposed = false;
    setProof(null); setConfirmed(false); setTracked(null);
    if (auth.subject) {
      try { const saved = JSON.parse(sessionStorage.getItem("prohodnaya-confirmed-attempt") || "null"); if (saved?.sub === auth.subject && typeof saved.id === "string") { setTracked(saved.id); setConfirmed(true); } } catch { sessionStorage.removeItem("prohodnaya-confirmed-attempt"); }
    }
    if (owner) storedProof(owner).then((value) => { if (!disposed) setProof(value); }).catch((error) => { if (!disposed) setMessage(errorMessage(error)); });
    return () => { disposed = true; };
  }, [owner]);

  async function register() {
    if (!allowed || !owner || lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      if (!crypto.subtle) throw new Error("Защищённый ключ недоступен. Откройте страницу по HTTPS.");
      const key = (await storedProof(owner)) || await generateProof();
      // Сохраняем до API: потеря ответа не должна потерять соответствующий приватный ключ.
      await storedProof(owner, key);
      setProof(key);
      const result = await apiRequest<{ device_id: string; reason_human: string }>("/devices", await auth.token(), { public_key: key.publicKey, label: "Браузер рабочего" });
      if (!result.device_id) throw new Error("Сервер не подтвердил привязку телефона.");
      const registered = { ...key, registered: true };
      await storedProof(owner, registered); setProof(registered); setMessage(result.reason_human);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  function acceptQr(text: string): boolean {
    try {
      const parsed = parseAttempt(text.trim(), location.origin);
      setAttempt(parsed); setConfirmed(false); setTracked(null); setMessage(null);
      sessionStorage.removeItem("prohodnaya-confirmed-attempt");
      sessionStorage.setItem("prohodnaya-pending-qr", text.trim());
      setInput(""); return true;
    } catch (error) { setMessage(errorMessage(error)); return false; }
  }

  async function track(id: string) {
    sessionStorage.removeItem("prohodnaya-pending-qr");
    sessionStorage.setItem("prohodnaya-confirmed-attempt", JSON.stringify({ sub: auth.subject, id }));
    setTracked(id); setConfirmed(true);
  }

  async function recover(id: string) {
    try {
      const saved = await apiRequest<{ status: string }>(`/attempts/${id}`, await auth.token());
      if (["scanned", "decided"].includes(saved.status)) { await track(id); return true; }
    } catch { /* Не выдаём предположение за подтверждение. */ }
    return false;
  }

  async function confirm() {
    if (!allowed || !owner || !attempt || !proof?.registered || lock.current || confirmed) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      const signature = await signNonce(proof.privateKey, attempt.nonce);
      const result = await apiRequest<{ confirmed: boolean; reason_human?: string; reason: string }>(`/attempts/${attempt.attempt_id}/scan`, await auth.token(), { nonce: attempt.nonce, signature });
      if (typeof result.confirmed !== "boolean") throw new Error("Сервер не вернул результат подтверждения.");
      setConfirmed(result.confirmed); setMessage(result.reason_human || result.reason);
      if (result.confirmed) await track(attempt.attempt_id);
      else await recover(attempt.attempt_id);
    } catch (error) { setMessage(errorMessage(error)); await recover(attempt.attempt_id); }
    finally { lock.current = false; setBusy(false); }
  }

  return <ScreenShell role="phone" title="Мой проход" description="Сканируйте QR контролёра внутри страницы, затем подтвердите попытку.">
    <section className="panel">
      <div className="section-heading"><h2>Ключ телефона</h2><span className="badge">{proof?.registered ? "Сохранён в браузере" : "Не привязан"}</span></div>
      <p className="muted">Привяжите этот браузер к своей учётной записи один раз. Повторная привязка отключит прежний ключ на сервере.</p>
      <button className="button full-width" disabled={!allowed || busy} onClick={register}>{busy ? "Выполняется запрос…" : proof?.registered ? "Повторить привязку этого телефона" : "Привязать этот телефон"}</button>
      <p className="hint">После очистки данных браузера потребуется новая привязка. Ключ другой учётной записи здесь не используется.</p>
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Подтверждение прохода</h2><span className="badge">{confirmed ? "Подтверждено" : attempt ? "QR получен" : "Ожидание QR"}</span></div>
      <Status tone={attempt ? "waiting" : "neutral"} title={confirmed ? "Телефон подтвердил попытку" : attempt ? "Готово к подтверждению" : "Сканируйте QR контролёра"}>{confirmed ? "Теперь контролёр снимает лицо. Это ещё не разрешение прохода: решение принимает сервер." : "QR выбирает попытку, а ваш ключ подписывает её. При истёкшем коде попросите контролёра открыть новый."}</Status>
      <button className="button full-width" disabled={!allowed || !proof?.registered || !attempt || busy || confirmed} onClick={confirm}>Подтвердить попытку</button>
      <details className="manual-qr"><summary>Вставить ссылку из QR вручную</summary><label htmlFor="qr-link">Ссылка контролёра</label><input id="qr-link" type="text" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://…/phone#attempt=…" /><button className="button button-secondary" onClick={() => acceptQr(input)} disabled={!input.trim() || busy}>Прочитать ссылку</button></details>
      {message && <p role="status" aria-live="polite" className="hint">{message}</p>}
    </section>
    <CameraPreview title="Сканер QR" description="Включите камеру и наведите её на код контролёра." onQr={!busy ? acceptQr : undefined} />
    {result.decision && <section className="panel"><Status tone={result.decision.decision === "deny" ? "error" : "neutral"} title={result.decision.decision === "allow" ? "Проход разрешён сервером" : "Проход не разрешён"}>{result.decision.reason}</Status></section>}
    {result.error && <p className="inline-error" role="alert">{result.error}</p>}
    <WorkerMovement revision={result.decision ? `${tracked}:${result.decision.decision}` : null} />
  </ScreenShell>;
}
