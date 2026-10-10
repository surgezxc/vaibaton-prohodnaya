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
  const [refusal, setRefusal] = useState<string | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);
  const confirmationPanel = useRef<HTMLElement>(null);
  const [tracked, setTracked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proofLoaded, setProofLoaded] = useState(false);
  const [insecureHttp, setInsecureHttp] = useState(false);
  const lock = useRef(false);
  const attemptRef = useRef<QrAttempt | null>(null);
  const proofRef = useRef<StoredProof | null>(null);
  const confirmedRef = useRef(false);
  const trackedRef = useRef<string | null>(null);
  const autoSent = useRef<string | null>(null);
  const confirmRef = useRef<(current?: QrAttempt | null) => Promise<void>>(async () => {});
  attemptRef.current = attempt;
  proofRef.current = proof;
  confirmedRef.current = confirmed;
  trackedRef.current = tracked;
  const allowed = auth.authenticated && auth.roles.includes("worker");
  const result = useAttemptStatus(allowed ? tracked : null, auth.subject, auth.token);
  const owner = auth.subject ? `${keycloakBase()}|${process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "prohodnaya"}|${auth.subject}` : null;
  const nextStep = !auth.ready ? "Дождитесь подключения входа."
    : !auth.authenticated ? "Сначала войдите через Keycloak в учётную запись рабочего, затем откройте свежий QR."
      : !allowed ? "Для подтверждения нужна учётная запись рабочего."
        : attempt && !proof?.registered ? "Сначала привяжите телефон"
          : !proof?.registered ? "Сначала нажмите «Привязать этот телефон» выше. После успешной привязки попросите контролёра открыть свежий QR."
            : confirmed ? "Телефон подтвердил попытку. Теперь на ноутбуке снимите лицо и отправьте кадр на проверку."
              : attempt ? "QR считан. Подтверждение уходит на сервер само, кнопка ниже не нужна."
                : "Включите сканер, затем попросите контролёра открыть QR.";

  useEffect(() => {
    if (!attempt) return;
    confirmationPanel.current?.focus({ preventScroll: true });
    confirmationPanel.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [attempt]);

  useEffect(() => { setInsecureHttp(window.isSecureContext === false); }, []);

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
    setProof(null); setProofLoaded(false); setConfirmed(false); setTracked(null); setRefusal(null);
    if (auth.subject) {
      try { const saved = JSON.parse(sessionStorage.getItem("prohodnaya-confirmed-attempt") || "null"); if (saved?.sub === auth.subject && typeof saved.id === "string") { setTracked(saved.id); setConfirmed(true); } } catch { sessionStorage.removeItem("prohodnaya-confirmed-attempt"); }
    }
    if (owner) storedProof(owner).then((value) => { if (!disposed) { setProof(value); setProofLoaded(true); } }).catch((error) => { if (!disposed) { setProofLoaded(true); setMessage(errorMessage(error)); } });
    else if (!disposed) setProofLoaded(true);
    return () => { disposed = true; };
  }, [owner]);

  async function register() {
    if (!allowed || !owner || lock.current) return;
    lock.current = true; setBusy(true); setMessage(null); setRegistrationMessage(null);
    try {
      if (!crypto.subtle?.generateKey) throw new Error("Ключ телефона на обычном HTTP недоступен. Для привязки откройте страницу по HTTPS.");
      const key = (await storedProof(owner)) || await generateProof();
      // Сохраняем до API: потеря ответа не должна потерять соответствующий приватный ключ.
      await storedProof(owner, key);
      setProof(key);
      const result = await apiRequest<{ device_id: string; reason_human: string }>("/devices", await auth.token(), { public_key: key.publicKey, label: "Браузер рабочего" });
      if (!result.device_id) throw new Error("Сервер не подтвердил привязку телефона.");
      const registered = { ...key, registered: true };
      await storedProof(owner, registered); setProof(registered); setRegistrationMessage(result.reason_human);
    } catch (error) { setRegistrationMessage(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  function acceptQr(text: string): boolean {
    try {
      const parsed = parseAttempt(text.trim(), location.origin);
      attemptRef.current = parsed;
      confirmedRef.current = false;
      trackedRef.current = null;
      setAttempt(parsed); setConfirmed(false); setTracked(null); setMessage(null); setRefusal(null);
      sessionStorage.removeItem("prohodnaya-confirmed-attempt");
      sessionStorage.setItem("prohodnaya-pending-qr", text.trim());
      setInput("");
      if (proofRef.current?.registered) void confirmRef.current(parsed);
      return true;
    } catch (error) { setMessage(errorMessage(error)); return false; }
  }

  async function track(id: string) {
    sessionStorage.removeItem("prohodnaya-pending-qr");
    sessionStorage.setItem("prohodnaya-confirmed-attempt", JSON.stringify({ sub: auth.subject, id }));
    trackedRef.current = id;
    confirmedRef.current = true;
    setTracked(id); setConfirmed(true);
  }

  async function recover(id: string) {
    try {
      const saved = await apiRequest<{ status: string }>(`/attempts/${id}`, await auth.token());
      if (["scanned", "decided"].includes(saved.status)) { await track(id); return true; }
    } catch { /* Не выдаём предположение за подтверждение. */ }
    return false;
  }

  async function confirm(current: QrAttempt | null = attemptRef.current) {
    const key = proofRef.current;
    if (!allowed || !owner || !current || !key?.registered || lock.current) return;
    if (confirmedRef.current && trackedRef.current === current.attempt_id) return;
    lock.current = true;
    autoSent.current = current.attempt_id;
    setBusy(true); setMessage(null); setRefusal(null);
    try {
      const signature = await signNonce(key.privateKey, current.nonce);
      const result = await apiRequest<{ confirmed: boolean; reason_human?: string; reason: string }>(`/attempts/${current.attempt_id}/scan`, await auth.token(), { nonce: current.nonce, signature });
      if (typeof result.confirmed !== "boolean") throw new Error("Сервер не вернул результат подтверждения.");
      const text = result.reason_human || result.reason;
      confirmedRef.current = result.confirmed;
      setConfirmed(result.confirmed); setMessage(text);
      if (result.confirmed) await track(current.attempt_id);
      else setRefusal(text || "Скан не принят.");
    } catch (error) { setMessage(errorMessage(error)); await recover(current.attempt_id); }
    finally { lock.current = false; setBusy(false); }
  }
  confirmRef.current = confirm;

  useEffect(() => {
    if (!allowed || !owner || !attempt || confirmed || !proof?.registered) return;
    if (autoSent.current === attempt.attempt_id) return;
    void confirmRef.current(attempt);
  }, [allowed, owner, attempt, confirmed, proof?.registered]);

  return <ScreenShell role="phone" title="Мой проход" description="Сканируйте QR контролёра внутри страницы, затем подтвердите попытку.">
    {insecureHttp && <p className="hint">Страница открыта по HTTP. Вход и экран сканера здесь есть. Камера, GPS и ключ телефона на этом адресе не работают: браузер даёт их только по HTTPS.</p>}
    <section className="panel">
      <div className="section-heading"><h2>Ключ телефона</h2><span className="badge">{proof?.registered ? "Сохранён в браузере" : "Не привязан"}</span></div>
      <p className="muted">Привяжите этот браузер к своей учётной записи один раз. Повторная привязка отключит прежний ключ на сервере.</p>
      <p className="hint">До первой привязки администратор должен завести рабочего с эталонным фото в <a href="/admin">админке</a> и связать его с вашей учёткой. Считывание QR само по себе этого не делает.</p>
      <button className="button full-width" disabled={!allowed || busy} onClick={register}>{busy ? "Выполняется запрос…" : proof?.registered ? "Повторить привязку этого телефона" : "Привязать этот телефон"}</button>
      {registrationMessage && <p role="status" aria-live="polite" className="hint">{registrationMessage}</p>}
      <p className="hint">После очистки данных браузера потребуется новая привязка. Ключ другой учётной записи здесь не используется.</p>
    </section>
    <section className="panel" ref={confirmationPanel} tabIndex={-1} aria-label="Подтверждение прохода">
      <div className="section-heading"><h2>Подтверждение прохода</h2><span className="badge">{confirmed ? "Подтверждено" : attempt ? "QR получен" : "Ожидание QR"}</span></div>
      <Status tone={refusal ? "error" : attempt ? "waiting" : "neutral"} title={refusal ?? (confirmed ? "Телефон подтвердил попытку" : attempt ? "QR считан — нужен следующий шаг" : "Подготовка к проходу")}>{refusal ? "Подтверждение не принято. Проверьте причину отказа выше; для новой попытки попросите контролёра открыть свежий QR." : nextStep}</Status>
      {attempt && !confirmed && proofLoaded && !proof?.registered ? <p className="hint" role="status">Сначала привяжите телефон</p> : null}
      <button className="button full-width" disabled={!allowed || !proof?.registered || !attempt || busy || confirmed} onClick={() => void confirm()}>Подтвердить попытку</button>
      <details className="manual-qr"><summary>Вставить ссылку из QR вручную</summary><label htmlFor="qr-link">Ссылка контролёра</label><input id="qr-link" type="text" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://…/phone#attempt=…" /><button className="button button-secondary" onClick={() => acceptQr(input)} disabled={!input.trim() || busy}>Прочитать ссылку</button></details>
      {message && <p role="status" aria-live="polite" className="hint">{message}</p>}
    </section>
    <CameraPreview title="Сканер QR" description="Включите камеру и наведите её на код контролёра." onQr={!busy ? acceptQr : undefined} />
    {result.decision && <section className="panel"><Status tone={result.decision.decision === "deny" ? "error" : "neutral"} title={result.decision.decision === "allow" ? "Проход разрешён сервером" : "Проход не разрешён"}>{result.decision.reason}</Status></section>}
    {result.error && <p className="inline-error" role="alert">{result.error}</p>}
    <WorkerMovement revision={result.decision ? `${tracked}:${result.decision.decision}` : null} />
  </ScreenShell>;
}
