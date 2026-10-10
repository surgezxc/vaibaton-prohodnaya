export type CalibrationPoint = { pixel_x: number; pixel_y: number; lat: number; lon: number };

export type Plan = { id: string; name: string; points: CalibrationPoint[] };

/** Кольцо зоны в формате API: пиксели плана [[x, y], ...]; GPS сервер проецирует в пиксели по трём точкам. */
export type Ring = Array<[number, number]>;

export type Zone = { id: string; name: string; photo_id: string | null; polygon: Ring | null; visits: number; empty: boolean };

export type PlanImage = { src: string; width: number; height: number };

const PLAN_IMAGE_KEY = "prohodnaya:plan-image:";

const ZONE_LOOK: Record<string, { photo: string; color: string; camera: string }> = {
  "Бетон": { photo: "/zones/beton.jpg", color: "#d99435", camera: "CAM-02A" },
  "Котлован": { photo: "/zones/kotlovan.jpg", color: "#6482d7", camera: "CAM-05B" },
  "Курилка": { photo: "/zones/kuryilka.jpg", color: "#4d9a78", camera: "CAM-04A" },
};

export function zoneLook(name: string) {
  return ZONE_LOOK[name] ?? { photo: null, color: "#7a857e", camera: "" };
}

export function readRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring = value.filter(
    (point): point is [number, number] => Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number",
  );
  return ring.length >= 3 ? ring : null;
}

/** Изображение плана API не хранит: оно лежит в браузере, привязанное к id плана. */
export function loadPlanImage(planId: string): PlanImage | null {
  try {
    const raw = localStorage.getItem(PLAN_IMAGE_KEY + planId);
    const parsed = raw ? (JSON.parse(raw) as PlanImage) : null;
    return parsed?.src && parsed.width && parsed.height ? parsed : null;
  } catch {
    return null;
  }
}

export function savePlanImage(planId: string, image: PlanImage): boolean {
  try {
    localStorage.setItem(PLAN_IMAGE_KEY + planId, JSON.stringify(image));
    return true;
  } catch {
    return false;
  }
}

export function readImageFile(file: File): Promise<PlanImage> {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      resolve({ src: canvas.toDataURL("image/jpeg", 0.82), width: canvas.width, height: canvas.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("Изображение не прочиталось."));
    };
    image.src = source;
  });
}

export function ringToPixels(ring: Ring | null): Array<{ x: number; y: number }> | null {
  return ring ? ring.map(([x, y]) => ({ x, y })) : null;
}
