"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { grabCameraFrame } from "@/lib/camera-frame";
import { decodeQr } from "@/lib/qr-reader";

export type FaceBox = { x: number; y: number; width: number; height: number };

type Located = {
  boxes: FaceBox[];
  imageWidth: number;
  imageHeight: number;
  viewWidth: number;
  viewHeight: number;
};

function usableBox(box: FaceBox): boolean {
  return [box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value))
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0;
}

function placeBox(box: FaceBox, frame: Located) {
  const { imageWidth, imageHeight, viewWidth, viewHeight } = frame;
  if (imageWidth < 1 || imageHeight < 1 || viewWidth < 1 || viewHeight < 1) return { display: "none" as const };
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const offsetX = (viewWidth - imageWidth * scale) / 2;
  const offsetY = (viewHeight - imageHeight * scale) / 2;
  return {
    left: `${offsetX + box.x * scale}px`,
    top: `${offsetY + box.y * scale}px`,
    width: `${box.width * scale}px`,
    height: `${box.height * scale}px`,
  };
}

export function CameraPreview({ title, description, onCapture, onQr, locateFaces, enabled = true, disabledReason }: {
  title: string;
  description: string;
  onCapture?: (frame: string) => void;
  onQr?: (text: string) => boolean;
  locateFaces?: (frame: string) => Promise<FaceBox[]>;
  enabled?: boolean;
  disabledReason?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const locateRef = useRef(locateFaces);
  locateRef.current = locateFaces;
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const tracking = Boolean(locateFaces);

  const stop = useCallback(() => {
    request.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
    setLoading(false);
    setLocated(null);
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

  useEffect(() => {
    if (!active || !tracking) {
      setLocated(null);
      return;
    }
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy || document.hidden) return;
      const videoEl = video.current;
      const stageEl = stage.current;
      const locate = locateRef.current;
      if (!videoEl || !stageEl || !locate) return;
      busy = true;
      try {
        const shot = await grabCameraFrame(videoEl, 0.85);
        if (!shot || stopped) return;
        const boxes = (await locate(shot.url)).filter(usableBox);
        if (stopped) return;
        const view = stageEl.getBoundingClientRect();
        setLocated({
          boxes,
          imageWidth: shot.width,
          imageHeight: shot.height,
          viewWidth: view.width,
          viewHeight: view.height,
        });
      } catch {
        if (!stopped) setLocated(null);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => { void tick(); }, 450);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, tracking]);

  async function start() {
    if (!enabled) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Камера на обычном HTTP не включается. Страница при этом открыта. Для камеры нужен HTTPS или localhost.");
      return;
    }
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: tracking
          ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (request.current !== current || document.hidden) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        if (tracking) setActive(true);
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

  async function capture() {
    const current = request.current;
    const videoEl = video.current;
    if (!videoEl) {
      setError("Камера ещё не готова к снимку.");
      return;
    }
    const shot = await grabCameraFrame(videoEl, 0.95);
    if (request.current !== current) return;
    if (!shot) {
      setError("Камера ещё не готова к снимку.");
      return;
    }
    onCapture?.(shot.url);
    stop();
  }

  const boxes = located?.boxes ?? [];

  return <section className="panel camera-panel" aria-label={title}>
    <div className="section-heading"><h2>{title}</h2><span className="badge">{active ? "Включена" : "Выключена"}</span></div>
    <p className="muted">{description}</p>
    <div className="camera-stage" ref={stage}>
      <video ref={video} className={tracking && !active ? "camera-idle" : undefined} muted playsInline hidden={tracking ? false : !active} aria-label="Предпросмотр камеры" />
      {active && tracking && located && <div className="face-overlay" aria-hidden="true">
        {boxes.map((box, index) => <span key={`${box.x}-${box.y}-${box.width}-${box.height}-${index}`} className="face-box" style={placeBox(box, located)} />)}
      </div>}
      {!active && <div className="camera-placeholder"><span aria-hidden="true">◎</span><p>Камера включается только по кнопке</p></div>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!enabled && disabledReason && <p className="hint" role="status">{disabledReason}</p>}
    <button className="button button-secondary" disabled={!enabled} onClick={active || loading ? stop : start}>{loading ? "Отменить включение" : active ? "Выключить камеру" : "Включить камеру"}</button>
    {onCapture && <button className="button capture-button" disabled={!active} onClick={() => { void capture(); }}>Снять кадр</button>}
    <p className="hint">{onQr ? "Наведите камеру на QR контролёра. После распознавания камера выключится." : onCapture ? "Кадр хранится только до завершения текущей попытки. Отправка — отдельной кнопкой." : tracking ? "Рамка на предпросмотре показывает, что камера видит лицо. Снимок для проверки берётся с этого же кадра." : "Только предпросмотр. Изображение не отправляется и не сохраняется."}</p>
  </section>;
}
