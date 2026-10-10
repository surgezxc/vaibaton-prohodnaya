"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type FrameCameraHandle = {
  snapshot: () => string | null;
};

export const FrameCamera = forwardRef<FrameCameraHandle, { title: string }>(function FrameCamera({ title }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setPending(false);
  }

  useEffect(() => stop, []);

  useImperativeHandle(ref, () => ({
    snapshot() {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return null;
      const longest = Math.max(video.videoWidth, video.videoHeight);
      const scale = Math.min(1, 720 / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      const comma = dataUrl.indexOf(",");
      return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    },
  }));

  async function start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Камера на обычном HTTP не включается. Страница при этом открыта. Для камеры нужен HTTPS или localhost.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = media;
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play();
      }
      setLive(true);
    } catch (cause) {
      stop();
      const name = cause instanceof DOMException ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Доступ к камере запрещён. Разрешите его в браузере и включите снова."
          : name === "NotFoundError"
            ? "Камера не найдена."
            : "Не удалось открыть камеру. Возможно, она занята другим приложением.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600">{live ? "включена" : "выключена"}</span>
      </div>
      <div className="mb-3 grid aspect-4/3 place-items-center overflow-hidden rounded-xl bg-stone-200">
        <video ref={videoRef} className={`h-full w-full object-cover ${live ? "" : "hidden"}`} muted playsInline />
        {live ? null : <p className="px-4 text-center text-sm text-stone-600">Камера КПП включается по кнопке. Кадр уходит на сервер только по «Снять и решить».</p>}
      </div>
      {error ? (
        <p className="mb-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="min-h-12 w-full rounded-xl border border-stone-300 px-4 font-semibold" onClick={live || pending ? stop : start}>
        {pending ? "Включаем…" : live ? "Выключить камеру" : "Включить камеру"}
      </button>
    </section>
  );
});
