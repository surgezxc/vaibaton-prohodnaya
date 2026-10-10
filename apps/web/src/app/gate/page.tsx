"use client";

import { useEffect, useRef, useState } from "react";
import { FrameCamera, type FrameCameraHandle } from "@/components/frame-camera";
import { LoginCard } from "@/components/login-card";
import { Notice, Panel, RoleWarning, Shell } from "@/components/shell";
import { useSession } from "@/components/use-session";
import { apiRequest, offlineReason, serverReason } from "@/lib/api";
import { apiBase } from "@/lib/config";
import { encodePass } from "@/lib/pass-code";
import { loadSession } from "@/lib/session";

type Direction = "in" | "out";

type OpenAttempt = {
  id: string;
  nonce: string;
  expiresAt: string;
  direction: Direction;
  done: boolean;
};

export default function GatePage() {
  const { session, login, logout } = useSession();
  return (
    <Shell current="/gate" session={session} onLogout={logout}>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Планшет проходной</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Контроль прохода</h1>
      <p className="mt-2 mb-5 max-w-2xl text-stone-600">
        Выберите вход или выход, откройте QR и снимите один кадр. Телефон рабочего должен успеть прочитать код.
      </p>
      {session ? (
        <>
          <RoleWarning session={session} role="gate" label="контролёр" />
          <GateDesk token={session.token} />
        </>
      ) : (
        <LoginCard username="gate" onSuccess={login} />
      )}
    </Shell>
  );
}

function GateDesk({ token }: { token: string }) {
  const cameraRef = useRef<FrameCameraHandle>(null);
  const openRef = useRef<OpenAttempt | null>(null);
  const [direction, setDirection] = useState<Direction>("in");
  const [attempt, setAttempt] = useState<OpenAttempt | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"open" | "decide" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ decision: string; reason: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    openRef.current = attempt;
  }, [attempt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const life = useRef(0);
  useEffect(() => {
    const marker = ++life.current;
    const onHide = () => {
      const current = openRef.current;
      const bearer = loadSession()?.token;
      if (!current || current.done || !bearer) return;
      current.done = true;
      void fetch(`${apiBase()}/attempts/${current.id}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}` },
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      const snapshot = openRef.current;
      const bearer = loadSession()?.token;
      window.setTimeout(() => {
        if (life.current !== marker) return;
        if (!snapshot || snapshot.done || !bearer || openRef.current !== snapshot) return;
        snapshot.done = true;
        void fetch(`${apiBase()}/attempts/${snapshot.id}/cancel`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}` },
          keepalive: true,
        }).catch(() => undefined);
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!attempt || attempt.done) {
      setQrUrl(null);
      return;
    }
    let cancelled = false;
    const payload = encodePass(attempt.id, attempt.nonce);
    void import("qrcode").then(async (QRCode) => {
      const url = await QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: "M" });
      if (!cancelled) setQrUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function openAttempt() {
    setBusy("open");
    setError(null);
    setNote(null);
    setResult(null);
    const response = await apiRequest("/attempts", "POST", token, { direction });
    setBusy(null);
    if (response.offline) {
      setError(offlineReason);
      return;
    }
    if (response.status !== 201 || !response.json) {
      setError(serverReason(response.json, "Попытку открыть не удалось."));
      return;
    }
    const id = response.json.attempt_id;
    const nonce = response.json.nonce;
    const expiresAt = response.json.expires_at;
    if (typeof id !== "string" || typeof nonce !== "string" || typeof expiresAt !== "string") {
      setError(serverReason(response.json, "Сервер открыл попытку без кода."));
      return;
    }
    const next = { id, nonce, expiresAt, direction, done: false };
    openRef.current = next;
    setAttempt(next);
  }

  async function closeAttempt() {
    const current = openRef.current;
    if (!current || current.done) {
      setAttempt(null);
      return;
    }
    setBusy("cancel");
    setError(null);
    const response = await apiRequest(`/attempts/${current.id}/cancel`, "POST", token);
    setBusy(null);
    if (response.offline) {
      setError("API недоступен. Код на сервере не отменён.");
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setError(serverReason(response.json, "Закрыть попытку не удалось."));
      return;
    }
    current.done = true;
    setAttempt({ ...current, done: true });
    setNote(serverReason(response.json, "Попытка закрыта."));
  }

  async function decide() {
    const current = openRef.current;
    if (!current || current.done) return;
    const image = cameraRef.current?.snapshot();
    if (!image) {
      setError("Нет кадра с проходной. Включите камеру и дождитесь изображения.");
      return;
    }
    setBusy("decide");
    setError(null);
    const response = await apiRequest(`/attempts/${current.id}/decide`, "POST", token, {
      nonce: current.nonce,
      image_base64: image,
    });
    setBusy(null);
    if (response.offline) {
      setError(offlineReason);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setError(serverReason(response.json, "Сервер не принял кадр."));
      return;
    }
    current.done = true;
    const reason = serverReason(response.json, "Сервер не прислал причину.");
    const decision = typeof response.json?.decision === "string" ? response.json.decision : "";
    setResult({ decision, reason });
    setAttempt({ ...current });
  }

  const secondsLeft = attempt
    ? Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - now) / 1000))
    : 0;
  const payload = attempt ? encodePass(attempt.id, attempt.nonce) : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Попытка" aside={<span className="text-sm text-stone-500">{attempt && !attempt.done ? "код открыт" : "кода нет"}</span>}>
        <fieldset className="mb-4 flex flex-wrap gap-2 border-0 p-0" disabled={Boolean(attempt && !attempt.done)}>
          <legend className="mb-2 text-sm text-stone-600">Направление</legend>
          <DirectionChoice value="in" current={direction} onPick={setDirection} label="Вход" />
          <DirectionChoice value="out" current={direction} onPick={setDirection} label="Выход" />
        </fieldset>
        <div className="mb-4 grid min-h-72 place-items-center rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-center">
          {qrUrl && attempt && !attempt.done ? (
            <div>
              <img src={qrUrl} alt="QR попытки прохода" width={320} height={320} className="mx-auto h-auto w-full max-w-80" />
              <p className="mt-2 text-sm font-semibold">{attempt.direction === "in" ? "Вход" : "Выход"} · ещё {secondsLeft} с</p>
              <p className="mt-1 text-xs break-all text-stone-500">{payload}</p>
            </div>
          ) : (
            <p className="max-w-xs text-sm text-stone-600">Попытка не открыта. QR появится после ответа сервера — телефон должен прочитать именно его.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-12 flex-1 rounded-xl bg-emerald-900 px-4 font-semibold text-white" onClick={() => void openAttempt()} disabled={busy !== null}>
            {busy === "open" ? "Открываем…" : attempt && !attempt.done ? "Открыть новый QR" : "Открыть QR"}
          </button>
          {attempt && !attempt.done ? (
            <button type="button" className="min-h-12 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => void closeAttempt()} disabled={busy !== null}>
              {busy === "cancel" ? "Закрываем…" : "Закрыть экран"}
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-stone-500">Закрытие экрана отменяет код, только если API ещё отвечает. Обрыв сети попытку не гасит.</p>
      </Panel>
      <div className="grid gap-4">
        <FrameCamera ref={cameraRef} title="Камера КПП" />
        <Panel title="Решение сервера">
          {result ? (
            <Notice tone={result.decision === "allow" ? "ok" : "bad"} title={result.decision === "allow" ? "Проход разрешён" : "Проход не разрешён"}>
              {result.reason}
            </Notice>
          ) : attempt && !attempt.done ? (
            <Notice tone="wait" title="Ждём телефон и кадр">
              Рабочий сканирует QR. Затем снимите лицо здесь.
            </Notice>
          ) : (
            <Notice title="Нет активной попытки">Откройте QR, чтобы сервер выдал одноразовый код.</Notice>
          )}
          {note ? <div className="mt-3"><Notice title="Код закрыт">{note}</Notice></div> : null}
          {error ? (
            <p className="mt-3 text-sm text-red-800" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-4 min-h-12 w-full rounded-xl bg-emerald-900 px-4 font-semibold text-white"
            onClick={() => void decide()}
            disabled={!attempt || attempt.done || busy !== null}
          >
            {busy === "decide" ? "Отправляем кадр…" : "Снять и решить"}
          </button>
        </Panel>
      </div>
    </div>
  );
}

function DirectionChoice({
  value,
  current,
  onPick,
  label,
}: {
  value: Direction;
  current: Direction;
  onPick: (value: Direction) => void;
  label: string;
}) {
  return (
    <label className={`min-h-12 flex-1 cursor-pointer rounded-xl border px-3 py-3 ${current === value ? "border-emerald-800 bg-emerald-50" : "border-stone-200"}`}>
      <input className="mr-2" type="radio" name="direction" checked={current === value} onChange={() => onPick(value)} />
      {label}
    </label>
  );
}
