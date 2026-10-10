"use client";

import { useState } from "react";
import { CameraPreview } from "@/components/camera-preview";
import { ScreenShell, Status } from "@/components/screen-shell";

type Direction = "in" | "out";

export default function GatePage() {
  const [direction, setDirection] = useState<Direction>("in");
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  function openAttempt() {
    setAttemptNumber((value) => value + 1);
    setOpen(true);
    setError(false);
  }

  return <ScreenShell role="gate" title="Контроль прохода" description="Выберите направление и откройте попытку для рабочего.">
    <div className="gate-grid">
      <section className="panel attempt-panel">
        <div className="section-heading"><h2>Попытка прохода</h2><span className="badge">Макет</span></div>
        <fieldset className="direction-picker" disabled={open}>
          <legend>Направление</legend>
          <label><input type="radio" name="direction" checked={direction === "in"} onChange={() => setDirection("in")} /><span>Вход на объект</span></label>
          <label><input type="radio" name="direction" checked={direction === "out"} onChange={() => setDirection("out")} /><span>Выход с объекта</span></label>
        </fieldset>
        <div className={`qr-stage ${open ? "qr-stage-open" : ""}`}>
          <span className="qr-outline" aria-hidden="true">{open ? "QR" : "+"}</span>
          <strong>{open ? "Место для серверного QR" : "Попытка не открыта"}</strong>
          <p>{open ? `Демо № ${attemptNumber} · ${direction === "in" ? "Вход" : "Выход"}. Этот макет нельзя сканировать.` : "После подключения сервера здесь появится одноразовый код."}</p>
        </div>
        <div className="button-row">
          <button className="button" onClick={openAttempt}>{open ? "Открыть новую демо-попытку" : "Открыть демо-попытку"}</button>
          {open && <button className="button button-secondary" onClick={() => { setOpen(false); setError(false); }}>Закрыть</button>}
        </div>
        <p className="hint">В рабочем режиме закрытие экрана отменяет QR на сервере.</p>
      </section>
      <CameraPreview title="Камера КПП" description="Предпросмотр лица перед отправкой на серверную проверку." />
    </div>
    <section className="panel result-panel">
      <div className="section-heading"><h2>Результат</h2><span className="badge">Без подключения</span></div>
      {error ? <Status tone="error" title="Проверка недоступна">Сервер не подключён. Проход не засчитан.</Status>
        : open ? <Status tone="waiting" title="Ожидание подтверждения">Демонстрационное состояние. Реальное подтверждение с телефона пока недоступно.</Status>
          : <Status title="Нет активной попытки">Откройте демо-попытку, чтобы проверить экран ожидания.</Status>}
      <button className="text-button" onClick={() => setError((value) => !value)}>{error ? "Вернуться к обычному состоянию" : "Показать пример ошибки"}</button>
    </section>
  </ScreenShell>;
}
