export type Ring = Array<[number, number]>;

export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (!crosses) continue;
    const xAtLat = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lng < xAtLat) inside = !inside;
  }
  return inside;
}

export function parseRing(input: unknown): Ring | null {
  let raw: unknown = input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const geo = input as { type?: unknown; coordinates?: unknown };
    if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
      raw = geo.coordinates[0];
    }
  }
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: Ring = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lng = point[0];
    const lat = point[1];
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    ring.push([lng, lat]);
  }
  return ring.length >= 3 ? ring : null;
}

export type ControlPoint = { lat: number; lng: number; label?: string };

export function parseControlPoints(input: unknown): ControlPoint[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length !== 3) return null;
  const points: ControlPoint[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const row = item as { lat?: unknown; lng?: unknown; label?: unknown };
    if (typeof row.lat !== "number" || typeof row.lng !== "number") return null;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
    const point: ControlPoint = { lat: row.lat, lng: row.lng };
    if (typeof row.label === "string" && row.label.trim()) point.label = row.label.trim();
    points.push(point);
  }
  return points;
}
