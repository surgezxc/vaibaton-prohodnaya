// Контракт services/face. Этот процесс только вызывает его.
// Реализация YOLO / InsightFace живёт в services/face, не здесь.
//
// POST {FACE_SERVICE_URL}/count_faces
//   { "image_base64": string }
//   → { "count": number }
//
// POST {FACE_SERVICE_URL}/embed
//   { "image_base64": string }
//   → { "embedding": number[] }
//
// POST {FACE_SERVICE_URL}/compare
//   { "embedding": number[], "image_base64": string }
//   → { "face_count": number, "score": number, "match": boolean, "live": boolean }
//
// Сеть, таймаут и ответ 5xx — «не готово». Кривой JSON — нет результата.

export class FaceNotReady extends Error {
  constructor() {
    super("не готово");
    this.name = "FaceNotReady";
  }
}

export class FaceResultMissing extends Error {
  constructor() {
    super("нет результата");
    this.name = "FaceResultMissing";
  }
}

export type CompareResult = {
  face_count: number;
  score: number | null;
  match: boolean;
  live: boolean;
};

function baseUrl(): string {
  return (process.env.FACE_SERVICE_URL ?? "").replace(/\/$/, "");
}

function timeoutMs(): number {
  const parsed = Number(process.env.FACE_TIMEOUT_MS ?? "8000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const root = baseUrl();
  if (!root) throw new FaceNotReady();
  let response: Response;
  try {
    response = await fetch(`${root}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch {
    throw new FaceNotReady();
  }
  if (response.status >= 500) throw new FaceNotReady();
  if (!response.ok) throw new FaceResultMissing();
  try {
    return await response.json();
  } catch {
    throw new FaceResultMissing();
  }
}

export function normalizeImage(input: string): string {
  const match = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  return (match ? match[1] : input).replace(/\s/g, "");
}

export async function countFaces(imageBase64: string): Promise<number> {
  const payload = await postJson("/count_faces", { image_base64: imageBase64 });
  if (!payload || typeof payload !== "object" || !("count" in payload)) {
    throw new FaceResultMissing();
  }
  const count = (payload as { count: unknown }).count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new FaceResultMissing();
  }
  return count;
}

export async function embedFace(imageBase64: string): Promise<number[]> {
  const payload = await postJson("/embed", { image_base64: imageBase64 });
  if (!payload || typeof payload !== "object" || !("embedding" in payload)) {
    throw new FaceResultMissing();
  }
  const embedding = (payload as { embedding: unknown }).embedding;
  if (!Array.isArray(embedding) || embedding.length < 1 || embedding.some((value) => typeof value !== "number")) {
    throw new FaceResultMissing();
  }
  return embedding as number[];
}

export async function compareFace(embedding: number[], imageBase64: string): Promise<CompareResult> {
  const payload = await postJson("/compare", { embedding, image_base64: imageBase64 });
  if (!payload || typeof payload !== "object") throw new FaceResultMissing();
  const row = payload as Record<string, unknown>;
  if (typeof row.face_count !== "number" || typeof row.match !== "boolean" || typeof row.live !== "boolean") {
    throw new FaceResultMissing();
  }
  const score = typeof row.score === "number" ? row.score : null;
  return { face_count: row.face_count, score, match: row.match, live: row.live };
}
