"use client";

import { useEffect, useRef, useState } from "react";

type Detected = { rawValue?: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };

function detectorOrNull(): Detector | null {
  const ctor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function QrScanner({ onCode }: { onCode: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);
  const [live, setLive] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    setSupported(detectorOrNull() !== null);
  }, []);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }

  useEffect(() => stop, []);

  useEffect(() => {
    if (!live) return;
    const detector = detectorOrNull();
    if (!detector) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      void detector
        .detect(video)
        .then((codes) => {
          const value = codes.find((code) => code.rawValue)?.rawValue;
          if (!stopped && value) onCodeRef.current(value);
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [live]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Камера недоступна. Вставьте код вручную.");
      setSupported(false);
      return;
    }
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
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
          ? "Доступ к камере запрещён. Вставьте код с экрана контролёра."
          : "Камера не открылась. Вставьте код вручную.",
      );
    }
  }

  return (
    <div>
      {supported ? (
        <>
          <div className="mb-3 grid aspect-4/3 place-items-center overflow-hidden rounded-xl bg-stone-200">
            <video ref={videoRef} className={`h-full w-full object-cover ${live ? "" : "hidden"}`} muted playsInline />
            {live ? null : <p className="px-4 text-center text-sm text-stone-600">Наведите камеру на QR контролёра.</p>}
          </div>
          <button type="button" className="min-h-12 w-full rounded-xl border border-stone-300 px-4 font-semibold" onClick={live ? stop : start}>
            {live ? "Выключить камеру" : "Сканировать QR"}
          </button>
        </>
      ) : (
        <p className="text-sm text-stone-600">Этот браузер не читает QR камерой. Вставьте текст кода ниже — он под QR на планшете.</p>
      )}
      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <label className="mt-4 block text-sm font-medium">
        Текст кода, если камера не прочитала
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-stone-300 px-3 py-3 font-mono text-sm"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder='{"attempt_id":"…","nonce":"…"}'
        />
      </label>
      <button
        type="button"
        className="mt-3 min-h-12 w-full rounded-xl bg-emerald-900 px-4 font-semibold text-white"
        onClick={() => onCode(paste)}
        disabled={!paste.trim()}
      >
        Отправить вставленный код
      </button>
    </div>
  );
}
