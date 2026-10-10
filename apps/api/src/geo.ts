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

export type CalibrationPoint = {
  pixel_x: number;
  pixel_y: number;
  lat: number;
  lon: number;
};

function det3(matrix: number[][]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function solve3(matrix: number[][], target: number[]): [number, number, number] | null {
  const base = det3(matrix);
  if (!Number.isFinite(base) || Math.abs(base) < 1e-8) return null;
  const coeff: number[] = [];
  for (let column = 0; column < 3; column += 1) {
    const replaced = matrix.map((row, rowIndex) =>
      row.map((value, index) => (index === column ? target[rowIndex] : value)),
    );
    const value = det3(replaced) / base;
    if (!Number.isFinite(value)) return null;
    coeff.push(value);
  }
  return coeff as [number, number, number];
}

export function calibrationUsable(points: CalibrationPoint[]): boolean {
  if (points.length !== 3) return false;
  const geo = det3(points.map((point) => [point.lon, point.lat, 1]));
  const pixel = det3(points.map((point) => [point.pixel_x, point.pixel_y, 1]));
  return Number.isFinite(geo) && Number.isFinite(pixel) && Math.abs(geo) >= 1e-8 && Math.abs(pixel) >= 1e-6;
}

/** Аффинное отображение GPS → пиксель плана по трём точкам. */
export function projectGps(
  points: CalibrationPoint[],
  lat: number,
  lon: number,
): { x: number; y: number } | null {
  if (!calibrationUsable(points)) return null;
  const matrix = points.map((point) => [point.lon, point.lat, 1]);
  const xCoeff = solve3(matrix, points.map((point) => point.pixel_x));
  const yCoeff = solve3(matrix, points.map((point) => point.pixel_y));
  if (!xCoeff || !yCoeff) return null;
  return {
    x: xCoeff[0] * lon + xCoeff[1] * lat + xCoeff[2],
    y: yCoeff[0] * lon + yCoeff[1] * lat + yCoeff[2],
  };
}

export function parseCalibration(input: unknown): CalibrationPoint[] | null {
  if (!Array.isArray(input) || input.length !== 3) return null;
  const points: CalibrationPoint[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const pixelX = typeof row.pixel_x === "number" ? row.pixel_x : row.x;
    const pixelY = typeof row.pixel_y === "number" ? row.pixel_y : row.y;
    const lat = row.lat;
    const lon = typeof row.lon === "number" ? row.lon : row.lng;
    if (typeof pixelX !== "number" || typeof pixelY !== "number" || typeof lat !== "number" || typeof lon !== "number") {
      return null;
    }
    if (![pixelX, pixelY, lat, lon].every((value) => Number.isFinite(value))) return null;
    points.push({ pixel_x: pixelX, pixel_y: pixelY, lat, lon });
  }
  return points;
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
