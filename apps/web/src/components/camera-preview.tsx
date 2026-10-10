"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function CameraPreview({ title, description }: { title: string; description: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    request.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      request.current += 1;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stop]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Камера недоступна. Откройте страницу по HTTPS или на localhost в поддерживаемом браузере.");
      return;
    }
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (request.current !== current || document.hidden) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (request.current === current) setActive(true);
    } catch (cause) {
      if (request.current !== current) return;
      stop();
      const name = cause instanceof DOMException ? cause.name : "";
      setError(name === "NotAllowedError"
        ? "Доступ к камере запрещён. Разрешите его в настройках браузера и попробуйте снова."
        : name === "NotFoundError"
          ? "Камера не найдена. Проверьте подключение устройства."
          : "Не удалось открыть камеру. Возможно, она занята другим приложением.");
    } finally {
      if (request.current === current) setLoading(false);
    }
  }

  return <section className="panel camera-panel" aria-label={title}>
    <div className="section-heading"><h2>{title}</h2><span className="badge">{active ? "Включена" : "Выключена"}</span></div>
    <p className="muted">{description}</p>
    <div className="camera-stage">
      <video ref={video} muted playsInline hidden={!active} aria-label="Предпросмотр камеры" />
      {!active && <div className="camera-placeholder"><span aria-hidden="true">◎</span><p>Камера включается только по кнопке</p></div>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="button button-secondary" onClick={active || loading ? stop : start}>{loading ? "Отменить включение" : active ? "Выключить камеру" : "Включить камеру"}</button>
    <p className="hint">Только предпросмотр. Изображение не отправляется и не сохраняется.</p>
  </section>;
}
