"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeQr } from "@/lib/qr-reader";

export function CameraPreview({ title, description, onCapture, onQr, enabled = true }: { title: string; description: string; onCapture?: (frame: string) => void; onQr?: (text: string) => boolean; enabled?: boolean }) {
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

  useEffect(() => { if (!enabled) stop(); }, [enabled, stop]);

  const onQrRef = useRef(onQr); onQrRef.current = onQr;
  useEffect(() => {
    if (!active || !onQrRef.current) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let last = "";
    const timer = setInterval(() => {
      if (!video.current?.videoWidth || !context || document.hidden) return;
      const scale = Math.min(1, 480 / video.current.videoWidth);
      canvas.width = Math.round(video.current.videoWidth * scale);
      canvas.height = Math.round(video.current.videoHeight * scale);
      if (!canvas.height) return;
      context.drawImage(video.current, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const text = decodeQr(image.data, image.width, image.height);
      if (text && text !== last) {
        last = text;
        if (onQrRef.current?.(text)) stop();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [active, stop]);

  async function start() {
    if (!enabled) return;
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

  function capture() {
    if (!video.current?.videoWidth || !video.current.videoHeight) {
      setError("Камера ещё не готова к снимку.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setError("Не удалось снять кадр."); return; }
    context.drawImage(video.current, 0, 0);
    onCapture?.(canvas.toDataURL("image/jpeg", 0.85));
    stop();
  }

  return <section className="panel camera-panel" aria-label={title}>
    <div className="section-heading"><h2>{title}</h2><span className="badge">{active ? "Включена" : "Выключена"}</span></div>
    <p className="muted">{description}</p>
    <div className="camera-stage">
      <video ref={video} muted playsInline hidden={!active} aria-label="Предпросмотр камеры" />
      {!active && <div className="camera-placeholder"><span aria-hidden="true">◎</span><p>Камера включается только по кнопке</p></div>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="button button-secondary" disabled={!enabled} onClick={active || loading ? stop : start}>{loading ? "Отменить включение" : active ? "Выключить камеру" : "Включить камеру"}</button>
    {onCapture && <button className="button capture-button" disabled={!active} onClick={capture}>Снять кадр</button>}
    <p className="hint">{onQr ? "Наведите камеру на QR контролёра. После распознавания камера выключится." : onCapture ? "Кадр хранится только до завершения текущей попытки. Отправка — отдельной кнопкой." : "Только предпросмотр. Изображение не отправляется и не сохраняется."}</p>
  </section>;
}
