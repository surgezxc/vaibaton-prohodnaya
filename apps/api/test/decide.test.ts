import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { createApp } from "../src/app.ts";
import { createPool } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import type { ApiApp } from "../src/types.ts";

process.env.JWT_HMAC_SECRET = "test-secret-prohodnaya";
delete process.env.KEYCLOAK_ISSUER;
process.env.ATTEMPT_TTL_SECONDS = "60";
process.env.MODEL_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://prohodnaya:prohodnaya@127.0.0.1:5432/prohodnaya_test";
process.env.DATABASE_URL = databaseUrl;

const secret = new TextEncoder().encode(process.env.JWT_HMAC_SECRET);
type FaceMode = "ok" | "nomatch" | "empty" | "down";

const faceMode: { current: FaceMode } = { current: "ok" };
let pool: Pool;
let app: ApiApp;
let faceUrl = "";
let closeFace: () => Promise<void> = async () => {};

async function token(sub: string, role: string): Promise<string> {
  return new SignJWT({ realm_access: { roles: [role] } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

function startFace(): Promise<void> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const mode = faceMode.current;
      if (req.url === "/count_faces") {
        res.end(JSON.stringify({ count: 1 }));
        return;
      }
      if (req.url === "/embed") {
        res.end(JSON.stringify({ embedding: [1, 0, 0, 0] }));
        return;
      }
      if (req.url === "/compare") {
        if (mode === "empty") {
          res.end(JSON.stringify({}));
          return;
        }
        if (mode === "nomatch") {
          res.end(JSON.stringify({ face_count: 1, score: 0.12, match: false, live: true }));
          return;
        }
        res.end(JSON.stringify({ face_count: 1, score: 0.93, match: true, live: true }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      faceUrl = `http://127.0.0.1:${port}`;
      process.env.FACE_SERVICE_URL = faceUrl;
      closeFace = () => new Promise((done) => server.close(() => done()));
      resolve();
    });
  });
}

async function api(path: string, method: string, bearer: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

async function enroll(admin: string, sub: string, name: string): Promise<string> {
  const created = await api("/people", "POST", admin, {
    full_name: name,
    keycloak_sub: sub,
    badge_number: "314",
    position: "арматурщик",
    company: "ООО «МонолитПодряд»",
    site_name: "ЖК Северный",
    issuer: "СтройГрад-Тест",
    valid_until: "2027-12-31",
    image_base64: "aW1hZ2U=",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.id as string;
}

async function bind(worker: string): Promise<{ device_id: string; device_secret: string }> {
  const device = await api("/devices", "POST", worker, { label: "телефон" });
  assert.equal(device.status, 201, JSON.stringify(device.json));
  return {
    device_id: device.json.device_id as string,
    device_secret: device.json.device_secret as string,
  };
}

async function openAttempt(gate: string, direction: "in" | "out") {
  const attempt = await api("/attempts", "POST", gate, { direction });
  assert.equal(attempt.status, 201, JSON.stringify(attempt.json));
  return {
    attempt_id: attempt.json.attempt_id as string,
    nonce: attempt.json.nonce as string,
  };
}

async function scan(
  worker: string,
  attemptId: string,
  nonce: string,
  device: { device_id: string; device_secret: string },
  extra: Record<string, unknown> = {},
) {
  const response = await api(`/attempts/${attemptId}/scan`, "POST", worker, {
    nonce,
    device_id: device.device_id,
    device_secret: device.device_secret,
    ...extra,
  });
  assert.equal(response.json.confirmed, true, JSON.stringify(response.json));
  return response;
}

async function openShifts(): Promise<Array<{ person_id: string }>> {
  const { rows } = await pool.query<{ person_id: string }>(
    "SELECT person_id FROM shifts WHERE ended_at IS NULL",
  );
  return rows;
}

describe("decide", () => {
  before(async () => {
    await startFace();
    pool = createPool(databaseUrl);
    await migrate(pool);
    app = createApp(pool);
  });

  after(async () => {
    await closeFace();
    await pool.end();
  });

  beforeEach(async () => {
    faceMode.current = "ok";
    process.env.FACE_SERVICE_URL = faceUrl;
    await pool.query(`
      TRUNCATE journal, visits, locations, shifts, attempts, devices, people
      RESTART IDENTITY CASCADE
    `);
  });

  it("успешный decide открывает одну смену", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    const personId = await enroll(admin, "worker-a", "Гаджиев Магомед Ибрагимович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);

    const decided = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
      allowed: true,
    });
    assert.equal(decided.status, 200);
    assert.equal(decided.json.decision, "allow");
    assert.match(String(decided.json.reason), /Смена открыта/);
    const shifts = await openShifts();
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0].person_id, personId);

    const journal = await pool.query<{ decision: string }>(
      "SELECT decision FROM journal WHERE attempt_id = $1 AND what = 'вход'",
      [attempt.attempt_id],
    );
    assert.equal(journal.rowCount, 1);
    assert.equal(journal.rows[0].decision, "allow");
  });

  it("повторный decide не открывает вторую смену", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Гаджиев Магомед Ибрагимович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    const body = { nonce: attempt.nonce, image_base64: "aW1hZ2U=" };
    const first = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, body);
    assert.equal(first.json.decision, "allow");

    const second = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, body);
    assert.equal(second.json.decision, "deny");
    assert.match(String(second.json.reason), /уже использован/);
    assert.equal((await openShifts()).length, 1);
    const total = await pool.query("SELECT count(*)::int AS n FROM shifts");
    assert.equal(total.rows[0].n, 1);
    const replay = await pool.query(
      "SELECT 1 FROM journal WHERE attempt_id = $1 AND decision = 'deny'",
      [attempt.attempt_id],
    );
    assert.ok((replay.rowCount ?? 0) >= 1);
  });

  it("протухший nonce не открывает смену", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Иванов Сергей Петрович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    await pool.query("UPDATE attempts SET expires_at = now() - interval '1 second' WHERE id = $1", [
      attempt.attempt_id,
    ]);

    const decided = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(decided.json.decision, "deny");
    assert.match(String(decided.json.reason), /устар/);
    assert.equal((await openShifts()).length, 0);
    const journal = await pool.query("SELECT reason FROM journal WHERE attempt_id = $1 AND decision = 'deny'", [
      attempt.attempt_id,
    ]);
    assert.match(String(journal.rows[0].reason), /устар/);
  });

  it("повтор того же кода после решения — replay и без новой смены", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Петров Андрей Николаевич");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
    });
    const replay = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
      allowed: true,
      decision: "allow",
    });
    assert.equal(replay.json.decision, "deny");
    assert.equal(replay.json.reason_code, "REPLAY");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM shifts")).rows[0].n, 1);
  });

  it("берёт человека из sub токена, а не из тела", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const workerA = await token("worker-a", "worker");
    const personA = await enroll(admin, "worker-a", "Смирнова Ольга Викторовна");
    const personB = await enroll(admin, "worker-b", "Юсупов Тимур Рашидович");
    const device = await bind(workerA);
    const attempt = await openAttempt(gate, "in");
    await scan(workerA, attempt.attempt_id, attempt.nonce, device, {
      person_id: personB,
      keycloak_sub: "worker-b",
    });
    const stored = await pool.query<{ person_id: string }>("SELECT person_id FROM attempts WHERE id = $1", [
      attempt.attempt_id,
    ]);
    assert.equal(stored.rows[0].person_id, personA);

    const decided = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
      person_id: personB,
      keycloak_sub: "worker-b",
      allowed: true,
    });
    assert.equal(decided.json.decision, "allow");
    const shifts = await pool.query<{ person_id: string }>("SELECT person_id FROM shifts");
    assert.equal(shifts.rowCount, 1);
    assert.equal(shifts.rows[0].person_id, personA);
    const other = await pool.query("SELECT 1 FROM shifts WHERE person_id = $1", [personB]);
    assert.equal(other.rowCount, 0);
  });

  it("повторный вход не создаёт вторую смену", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Ким Андрей Сергеевич");
    const device = await bind(worker);
    const first = await openAttempt(gate, "in");
    await scan(worker, first.attempt_id, first.nonce, device);
    assert.equal(
      (await api(`/attempts/${first.attempt_id}/decide`, "POST", gate, {
        nonce: first.nonce,
        image_base64: "aW1hZ2U=",
      })).json.decision,
      "allow",
    );

    const second = await openAttempt(gate, "in");
    await scan(worker, second.attempt_id, second.nonce, device);
    const denied = await api(`/attempts/${second.attempt_id}/decide`, "POST", gate, {
      nonce: second.nonce,
      image_base64: "aW1hZ2U=",
      allowed: true,
    });
    assert.equal(denied.json.decision, "deny");
    assert.match(String(denied.json.reason), /уже на объекте/);
    assert.equal((await openShifts()).length, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM shifts")).rows[0].n, 1);
  });

  it("выход без смены получает отказ", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Назаров Бахтиёр Умарович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "out");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    const decided = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(decided.json.decision, "deny");
    assert.match(String(decided.json.reason), /вне объекта/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM shifts")).rows[0].n, 0);
    const journal = await pool.query("SELECT reason FROM journal WHERE attempt_id = $1 AND decision = 'deny'", [
      attempt.attempt_id,
    ]);
    assert.match(String(journal.rows.at(-1)?.reason), /вне объекта/);
  });

  it("если лицо не готово, отказ по-русски и строка в журнале", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Кузнецов Максим Олегович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");
    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    process.env.FACE_SERVICE_URL = "http://127.0.0.1:9";

    const decided = await api(`/attempts/${attempt.attempt_id}/decide`, "POST", gate, {
      nonce: attempt.nonce,
      image_base64: "aW1hZ2U=",
      allowed: true,
    });
    assert.equal(decided.json.decision, "deny");
    assert.match(String(decided.json.reason), /не готово/);
    assert.equal((await openShifts()).length, 0);
    const journal = await pool.query<{ reason: string }>(
      "SELECT reason FROM journal WHERE attempt_id = $1 AND decision = 'deny'",
      [attempt.attempt_id],
    );
    assert.match(journal.rows[0].reason, /не готово/);
  });

  it("чужое лицо и пустой ответ face не пускают", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Эргашев Дилшод Каримович");
    const device = await bind(worker);

    faceMode.current = "nomatch";
    const mismatch = await openAttempt(gate, "in");
    await scan(worker, mismatch.attempt_id, mismatch.nonce, device);
    const wrong = await api(`/attempts/${mismatch.attempt_id}/decide`, "POST", gate, {
      nonce: mismatch.nonce,
      image_base64: "aW1hZ2U=",
      allowed: true,
      person_id: "someone-else",
    });
    assert.equal(wrong.json.decision, "deny");
    assert.match(String(wrong.json.reason), /не совпало/);
    assert.equal((await openShifts()).length, 0);

    faceMode.current = "empty";
    const missing = await openAttempt(gate, "in");
    await scan(worker, missing.attempt_id, missing.nonce, device);
    const noResult = await api(`/attempts/${missing.attempt_id}/decide`, "POST", gate, {
      nonce: missing.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(noResult.json.decision, "deny");
    assert.match(String(noResult.json.reason), /Нет результата/);
    const journal = await pool.query(
      "SELECT reason FROM journal WHERE attempt_id = $1",
      [missing.attempt_id],
    );
    assert.match(String(journal.rows.at(-1)?.reason), /Нет результата/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM shifts")).rows[0].n, 0);
  });
});
