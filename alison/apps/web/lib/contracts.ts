export type ApiEnvelope<T> = T[] | { items?: T[]; data?: T[]; people?: T[]; rows?: T[] };

export type Person = {
  id: string;
  full_name: string;
  badge_system?: string;
  badge_number?: string;
  position?: string;
  contractor?: string;
  object_name?: string;
  valid_until?: string;
  keycloak_sub?: string;
  status?: string;
  inside_since?: string;
};

export type JournalEntry = {
  id?: string;
  person_name?: string;
  person_id?: string;
  event?: string;
  direction?: string;
  result?: string;
  reason_human?: string;
  created_at?: string;
};

export type CurrentPerson = {
  person_id?: string;
  full_name?: string;
  name?: string;
  started_at?: string;
  shift_started_at?: string;
};

export type HeatZone = {
  zone_id?: string;
  zone_name?: string;
  name?: string;
  visits?: number;
  visit_count?: number;
  polygon?: Array<{ x?: number; y?: number; pixel_x?: number; pixel_y?: number }>;
};

export type RoutePoint = {
  person_id?: string;
  person_name?: string;
  full_name?: string;
  zone_id?: string;
  zone_name?: string;
  visited_at?: string;
  created_at?: string;
};

export type ReportRow = {
  person_id?: string;
  person_name?: string;
  full_name?: string;
  shift_started_at?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_minutes?: number;
  visits?: number;
};

export type AssistantResult = {
  answer?: string;
  text?: string;
  message?: string;
  status?: string;
};

export type SitePlanRecord = {
  id: string;
  name?: string;
  width?: number;
  height?: number;
};

export type PlanCalibrationRecord = {
  pixel_x: number;
  pixel_y: number;
  lat: number;
  lon: number;
};

export type ZoneSpec = {
  id: string;
  name: string;
  image: string;
  camera: string;
};

export const API_PATHS = {
  people: "people",
  journal: "journal",
  siteNow: "site/now",
  analyticsHeat: "analytics/heat",
  analyticsRoutes: "analytics/routes",
  analyticsReports: "analytics/reports",
  assistantAsk: "assistant/ask",
  assistantSummary: "assistant/summary",
  plans: "plans",
  planCalibration: (id: string) => "plans/" + encodeURIComponent(id) + "/calibration",
  zonePolygon: (id: string) => "zones/" + id + "/polygon",
};

export type PersonDraft = {
  full_name: string;
  badge_system: string;
  badge_number: string;
  position: string;
  contractor: string;
  object_name: string;
  valid_until: string;
  keycloak_sub: string;
};

export function personFormData(person: PersonDraft, photo?: File): FormData {
  const body = new FormData();
  Object.entries(person).forEach(([key, value]) => body.append(key, value.trim()));
  if (photo) body.append("reference_photo", photo);
  return body;
}

export type CoordinatePoint = { x: number; y: number };
export type GeoreferencePoint = CoordinatePoint & { latitude: number; longitude: number };

export function zonePolygonPayload(polygon: CoordinatePoint[], width: number, height: number) {
  return {
    polygon: polygon.map(({ x, y }) => ({
      pixel_x: Number((x / 100 * width).toFixed(2)),
      pixel_y: Number((y / 100 * height).toFixed(2)),
    })),
  };
}

export function planCalibrationPayload(controlPoints: GeoreferencePoint[]) {
  return {
    points: controlPoints.map(({ x, y, latitude, longitude }) => ({
      pixel_x: x,
      pixel_y: y,
      lat: latitude,
      lon: longitude,
    })),
  };
}

export function plansFrom(value: unknown): SitePlanRecord[] {
  const rows = listFrom<Record<string, unknown>>(value, ["items", "data", "plans"]);
  return rows.flatMap((row) => {
    const id = row.id ?? row.plan_id;
    if (id == null) return [];
    const width = Number(row.width ?? row.image_width ?? row.pixel_width);
    const height = Number(row.height ?? row.image_height ?? row.pixel_height);
    return [{
      id: String(id),
      name: String(row.name ?? row.title ?? row.label ?? "План " + id),
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height } : {}),
    }];
  });
}

export function calibrationFrom(value: unknown): PlanCalibrationRecord[] {
  const rows = listFrom<Record<string, unknown>>(value, ["items", "data", "points", "calibration", "calibration_points"]);
  return rows.flatMap((row) => {
    const pixelX = Number(row.pixel_x ?? row.x);
    const pixelY = Number(row.pixel_y ?? row.y);
    const lat = Number(row.lat ?? row.latitude);
    const lon = Number(row.lon ?? row.longitude);
    if (![pixelX, pixelY, lat, lon].every(Number.isFinite)) return [];
    return [{ pixel_x: pixelX, pixel_y: pixelY, lat, lon }];
  });
}

export const ZONES: ZoneSpec[] = [
  { id: "beton", name: "Бетон", image: "/zones/beton.jpg", camera: "CAM-02A" },
  { id: "kotlovan", name: "Котлован", image: "/zones/kotlovan.jpg", camera: "CAM-05B" },
  { id: "kuryilka", name: "Курилка", image: "/zones/kuryilka.jpg", camera: "CAM-04A" },
];

export function listFrom<T>(value: unknown, keys: string[] = ["items", "data", "people", "rows"]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

export function displayPersonName(person?: Person | CurrentPerson | RoutePoint | ReportRow): string {
  if (!person) return "Неизвестный человек";
  const item = person as Record<string, unknown>;
  return String(item.full_name || item.person_name || item.name || "Без имени");
}

export function statusLabel(status?: string): string {
  const values: Record<string, string> = {
    inside: "На объекте",
    active: "Активен",
    inactive: "Неактивен",
    pending: "Не привязан",
    blocked: "Заблокирован",
  };
  return values[(status || "").toLowerCase()] || status || "Статус не указан";
}
