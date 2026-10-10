"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginCard } from "@/components/login-card";
import { Notice, Panel, RoleWarning, Shell } from "@/components/shell";
import { QrScanner } from "@/components/qr-scanner";
import { useSession } from "@/components/use-session";
import { apiRequest, offlineReason, serverReason } from "@/lib/api";
import { browserDeviceKey, signNonce } from "@/lib/device-key";
import { decodePass } from "@/lib/pass-code";
import type { Session } from "@/lib/session";

const ZONES = ["Бетон", "Котлован", "Курилка"] as const;
const BOUND = "prohodnaya.device.boundSub";

export default function PhonePage() {
  const { session, login, logout } = useSession();
  return (
    <Shell current="/phone" session={session} onLogout={logout}>
      <div className="mx-auto max-w-lg">
        <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Телефон рабочего</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Мой проход</h1>
        <p className="mt-2 mb-5 text-stone-600">
          Один раз привяжите ключ этого браузера, отсканируйте QR контролёра и подпишите код.
        </p>
        {session ? (
          <>
            <RoleWarning session={session} role="worker" label="рабочий" />
            <PhoneDesk session={session} />
          </>
        ) : (
          <LoginCard username="worker" onSuccess={login} />
        )}
      </div>
    </Shell>
  );
}

function PhoneDesk({ session }: { session: Session }) {
  const [deviceMessage, setDeviceMessage] = useState("Привязываем ключ телефона…");
  const [deviceOk, setDeviceOk] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanOk, setScanOk] = useState<boolean | null>(null);
  const [zoneMessage, setZoneMessage] = useState<string | null>(null);
  const [pendingZone, setPendingZone] = useState<string | null>(null);
  const [binding, setBinding] = useState(false);

  const bind = useCallback(async (force: boolean) => {
    if (!force && localStorage.getItem(BOUND) === session.sub) {
      setDeviceOk(true);
      setDeviceMessage("Ключ этого браузера уже привязан к учётке.");
      return;
    }
    setBinding(true);
    setDeviceOk(false);
    try {
      const key = await browserDeviceKey();
      const response = await apiRequest("/devices", "POST", session.token, {
        public_key: key.spki,
        label: "браузер рабочего",
      });
      if (response.offline) {
        setDeviceMessage(offlineReason);
        return;
      }
      if (response.status !== 201) {
        setDeviceMessage(serverReason(response.json, "Телефон не привязан."));
        return;
      }
      localStorage.setItem(BOUND, session.sub);
      setDeviceOk(true);
      setDeviceMessage(serverReason(response.json, "Телефон привязан."));
    } catch {
      setDeviceMessage("Не удалось создать ключ в этом браузере.");
    } finally {
      setBinding(false);
    }
  }, [session.sub, session.token]);

  useEffect(() => {
    void bind(false);
  }, [bind]);

  async function submitCode(raw: string) {
    const pass = decodePass(raw);
    if (!pass) {
      setScanOk(false);
      setScanMessage("В тексте нет попытки и nonce. Скопируйте строку под QR.");
      return;
    }
    setScanOk(null);
    setScanMessage("Подписываем код…");
    try {
      const key = await browserDeviceKey();
      const signature = await signNonce(key.privateKey, pass.nonce);
      const response = await apiRequest(`/attempts/${pass.attemptId}/scan`, "POST", session.token, {
        nonce: pass.nonce,
        signature,
      });
      if (response.offline) {
        setScanOk(false);
        setScanMessage(offlineReason);
        return;
      }
      const confirmed = response.json?.confirmed === true;
      setScanOk(confirmed);
      setScanMessage(serverReason(response.json, "Сервер не подтвердил скан."));
    } catch {
      setScanOk(false);
      setScanMessage("Не удалось подписать код ключом этого браузера.");
    }
  }

  async function markZone(zone: string) {
    setPendingZone(zone);
    setZoneMessage(null);
    const response = await apiRequest("/locations", "POST", session.token, {
      source: "button",
      zone_name: zone,
    });
    setPendingZone(null);
    if (response.offline) {
      setZoneMessage(offlineReason);
      return;
    }
    setZoneMessage(serverReason(response.json, "Точку записать не удалось."));
  }

  return (
    <div className="grid gap-4">
      <Panel title="Ключ телефона" aside={<span className="text-xs text-stone-500">{deviceOk ? "привязан" : "не привязан"}</span>}>
        <p className="mb-3 text-sm text-stone-600">{deviceMessage}</p>
        <p className="mb-3 text-xs break-all text-stone-500">
          sub учётки для карточки в кадрах: {session.sub || "—"}
        </p>
        <button type="button" className="min-h-12 w-full rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => void bind(true)} disabled={binding}>
          {binding ? "Привязываем…" : "Привязать ключ ещё раз"}
        </button>
      </Panel>
      <Panel title="Скан QR">
        <QrScanner onCode={(value) => void submitCode(value)} />
        {scanMessage ? (
          <div className="mt-4">
            <Notice tone={scanOk ? "ok" : scanOk === false ? "bad" : "wait"} title={scanOk ? "Телефон подтвердил" : scanOk === false ? "Скан не принят" : "Ждём сервер"}>
              {scanMessage}
            </Notice>
          </div>
        ) : null}
      </Panel>
      <Panel title="Симуляция зоны">
        <p className="mb-3 text-sm text-stone-600">
          Кнопки — симуляция, не GPS. Фоновую геолокацию не обещаем: точка уходит только по нажатию, пока эта страница открыта.
        </p>
        <div className="grid gap-2">
          {ZONES.map((zone) => (
            <button
              key={zone}
              type="button"
              className="min-h-12 rounded-xl border border-stone-300 px-4 font-semibold"
              onClick={() => void markZone(zone)}
              disabled={pendingZone !== null}
            >
              {pendingZone === zone ? "Отправляем…" : `${zone} · симуляция`}
            </button>
          ))}
        </div>
        {zoneMessage ? <p className="mt-3 text-sm text-stone-700">{zoneMessage}</p> : null}
      </Panel>
    </div>
  );
}
