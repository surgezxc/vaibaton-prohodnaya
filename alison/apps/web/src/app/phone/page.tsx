"use client";

import { useEffect, useRef, useState } from "react";
import { CameraPreview } from "@/components/camera-preview";
import { ScreenShell, Status } from "@/components/screen-shell";

export default function PhonePage() {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  function check() {
    setChecking(true);
    setChecked(false);
    timeout.current = setTimeout(() => {
      setChecking(false);
      setChecked(true);
    }, 600);
  }

  return <ScreenShell role="phone" title="Мой проход" description="Сканируйте QR на экране контролёра перед входом или выходом.">
    <section className="panel">
      <div className="section-heading"><h2>Подтверждение</h2><span className="badge">Не подключено</span></div>
      <p className="muted">Войдите под своей учётной записью рабочего. Вход и регистрация средства подтверждения появятся после подключения сервера.</p>
      <button className="button full-width" disabled aria-describedby="sign-in-note">Войти в систему</button>
      <p className="hint" id="sign-in-note">Вход пока недоступен в этом каркасе.</p>
    </section>
    <CameraPreview title="Камера телефона" description="Проверьте доступ к камере. Распознавание QR пока не подключено." />
    <section className="panel">
      <div className="section-heading"><h2>Моя смена</h2><span className="badge">Нет данных</span></div>
      {checking ? <Status tone="waiting" title="Демонстрация загрузки">Проверяем состояние экрана…</Status>
        : checked ? <Status tone="error" title="Состояние недоступно">Сервер не подключён. Сведения о смене не получены.</Status>
          : <Status title="Смена неизвестна">После подключения здесь появятся состояние смены и время входа.</Status>}
      <button className="button button-secondary full-width" disabled={checking} onClick={check}>{checking ? "Загрузка…" : "Показать пример загрузки"}</button>
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Местоположение</h2><span className="badge">Выключено</span></div>
      <p className="muted">Во время открытой смены координаты будут отправляться раз в 60 секунд. Сейчас геолокация не запрашивается.</p>
      <div className="info-row"><span>Последняя отправка</span><strong>Нет данных</strong></div>
      <div className="info-row"><span>Точность</span><strong>Нет данных</strong></div>
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Симуляция зон</h2><span className="badge">Демо</span></div>
      <p className="muted" id="zones-note">Кнопки станут доступны после подключения API и получения открытой смены.</p>
      <div className="zone-buttons">{["Бетон", "Котлован", "Курилка"].map((zone) => <button key={zone} className="button button-secondary" disabled aria-describedby="zones-note">{zone}</button>)}</div>
    </section>
  </ScreenShell>;
}
