import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import { renderModelText } from "../src/modules/assistant.ts";
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

type DeviceKey = { spki: string; privateKey: KeyObject };

function createDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey,
  };
}

function signatureFor(device: DeviceKey, nonce: string): string {
  return sign("sha256", Buffer.from(nonce, "utf8"), {
    key: device.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

async function bind(worker: string, device = createDeviceKey()): Promise<DeviceKey & { device_id: string }> {
  const response = await api("/devices", "POST", worker, { public_key: device.spki, label: "телефон" });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  assert.equal(response.json.device_secret, undefined);
  return { ...device, device_id: response.json.device_id as string };
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
  device: DeviceKey,
  extra: Record<string, unknown> = {},
) {
  const response = await api(`/attempts/${attemptId}/scan`, "POST", worker, {
    nonce,
    signature: signatureFor(device, nonce),
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
    await pool.query("DELETE FROM plan_calibration_points");
    await pool.query("UPDATE zones SET polygon = NULL");
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

  it("скопированный JWT без ключа устройства — чужое устройство", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    const other = await token("worker-b", "worker");
    await enroll(admin, "worker-a", "Гаджиев Магомед Ибрагимович");
    await enroll(admin, "worker-b", "Юсупов Тимур Рашидович");
    const device = await bind(worker);
    const attempt = await openAttempt(gate, "in");

    const copied = await api(`/attempts/${attempt.attempt_id}/scan`, "POST", worker, {
      nonce: attempt.nonce,
      signature: signatureFor(createDeviceKey(), attempt.nonce),
      person_id: "someone-else",
    });
    assert.equal(copied.json.confirmed, false);
    assert.match(String(copied.json.reason), /чужое устройство/i);

    const missing = await api(`/attempts/${attempt.attempt_id}/scan`, "POST", worker, {
      nonce: attempt.nonce,
    });
    assert.match(String(missing.json.reason), /чужое устройство/i);

    const foreign = await bind(other);
    const stolen = await api(`/attempts/${attempt.attempt_id}/scan`, "POST", other, {
      nonce: attempt.nonce,
      signature: signatureFor(device, attempt.nonce),
    });
    assert.equal(stolen.json.confirmed, false);
    assert.match(String(stolen.json.reason), /чужое устройство/i);

    await scan(worker, attempt.attempt_id, attempt.nonce, device);
    const stored = await pool.query<{ person_id: string }>(
      "SELECT person_id FROM attempts WHERE id = $1",
      [attempt.attempt_id],
    );
    const owner = await pool.query<{ id: string }>("SELECT id FROM people WHERE keycloak_sub = 'worker-a'");
    assert.equal(stored.rows[0].person_id, owner.rows[0].id);
    assert.notEqual(foreign.device_id, device.device_id);
  });

  it("обрыв связи не отменяет попытку; cancel и ttl — да", async () => {
    const admin = await token("admin-sub", "admin");
    const gate = await token("gate-sub", "gate");
    const worker = await token("worker-a", "worker");
    await enroll(admin, "worker-a", "Иванов Сергей Петрович");
    const device = await bind(worker);

    const live = await openAttempt(gate, "in");
    await scan(worker, live.attempt_id, live.nonce, device);
    const status = await pool.query<{ status: string }>("SELECT status FROM attempts WHERE id = $1", [live.attempt_id]);
    assert.equal(status.rows[0].status, "scanned");
    const allowed = await api(`/attempts/${live.attempt_id}/decide`, "POST", gate, {
      nonce: live.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(allowed.json.decision, "allow");

    const closed = await openAttempt(gate, "out");
    await scan(worker, closed.attempt_id, closed.nonce, device);
    const cancel = await api(`/attempts/${closed.attempt_id}/cancel`, "POST", gate);
    assert.equal(cancel.status, 200);
    const denied = await api(`/attempts/${closed.attempt_id}/decide`, "POST", gate, {
      nonce: closed.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(denied.json.decision, "deny");
    assert.match(String(denied.json.reason), /отмен/);

    const stale = await openAttempt(gate, "out");
    await scan(worker, stale.attempt_id, stale.nonce, device);
    await pool.query("UPDATE attempts SET expires_at = now() - interval '1 second' WHERE id = $1", [stale.attempt_id]);
    const expired = await api(`/attempts/${stale.attempt_id}/decide`, "POST", gate, {
      nonce: stale.nonce,
      image_base64: "aW1hZ2U=",
    });
    assert.equal(expired.json.decision, "deny");
    assert.match(String(expired.json.reason), /устар/);
    assert.equal((await openShifts()).length, 1);
  });

  it("сервер подставляет числа по имени поля", () => {
    const numbers = { people: 12, shifts: 3, deviations: 1, refusals: 0, anomalies: 2 };
    const moved = renderModelText("Отказов 12, людей 0.", numbers, "КАНОН", "summary");
    assert.equal(moved.usedModel, false);
    assert.equal(moved.text, "КАНОН");
    const kept = renderModelText(
      "Людей {people}, смен {shifts}, отклонений {deviations}, отказов {refusals}, аномалий {anomalies}.",
      numbers,
      "КАНОН",
      "summary",
    );
    assert.equal(kept.usedModel, true);
    assert.equal(kept.text, "Людей 12, смен 3, отклонений 1, отказов 0, аномалий 2.");
    const visitsWord = renderModelText("В зоне {people} посещений.", { people: 4, metric: "человек" }, "КАНОН", "busiest_people");
    assert.equal(visitsWord.usedModel, false);
    const peopleWord = renderModelText("В зоне людей: {people} человек.", { people: 4, metric: "человек" }, "КАНОН", "busiest_people");
    assert.equal(peopleWord.text, "В зоне людей: 4 человек.");
  });

  it("тепло остаётся на посещениях, вопрос про людей считает человек", async () => {
    const manager = await token("manager-sub", "manager");
    await pool.query(`
      INSERT INTO people (id, full_name) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Иванов Сергей Петрович'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Петров Андрей Николаевич'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Смирнова Ольга Викторовна')
    `);
    await pool.query(`
      INSERT INTO shifts (id, person_id) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')
    `);
    await pool.query(`
      INSERT INTO visits (shift_id, zone_id) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '11111111-1111-4111-8111-111111111101'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '11111111-1111-4111-8111-111111111101'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '11111111-1111-4111-8111-111111111101'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '11111111-1111-4111-8111-111111111102'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '11111111-1111-4111-8111-111111111102'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '11111111-1111-4111-8111-111111111102'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '11111111-1111-4111-8111-111111111102'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '11111111-1111-4111-8111-111111111102')
    `);

    const heat = await api("/analytics/heat", "GET", manager);
    assert.equal(heat.json.metric, "посещения");
    const zones = heat.json.zones as Array<{ name: string; visits: number }>;
    const beton = zones.find((zone) => zone.name === "Бетон");
    const pit = zones.find((zone) => zone.name === "Котлован");
    assert.equal(beton?.visits, 3);
    assert.equal(pit?.visits, 5);

    const asked = await api("/assistant/ask", "POST", manager, {
      question: "в какой зоне больше всего людей",
    });
    assert.match(String(asked.json.text), /Бетон/);
    assert.match(String(asked.json.text), /человек/);
    assert.doesNotMatch(String(asked.json.text), /посещен/);
    const facts = asked.json.facts as { tool: string; numbers: { people: number; metric: string } };
    assert.equal(facts.tool, "busiest_people");
    assert.equal(facts.numbers.people, 2);
    assert.equal(facts.numbers.metric, "человек");
  });

  it("сводка считает отклонения и аномалии в SQL", async () => {
    const manager = await token("manager-sub", "manager");
    await pool.query(`
      INSERT INTO people (id, full_name) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Иванов Сергей Петрович'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Петров Андрей Николаевич')
    `);
    await pool.query(`
      INSERT INTO shifts (person_id, started_at, ended_at, duration_seconds) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', now() - interval '2 hours', now() - interval '1 hour', 3600)
    `);
    await pool.query(`
      INSERT INTO shifts (person_id, started_at) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', now() - interval '6 hours')
    `);
    await pool.query(
      `INSERT INTO journal (what, decision, reason) VALUES ('отказ', 'deny', 'Лицо не совпало с эталоном.')`,
    );
    const summary = await api("/assistant/summary", "POST", manager, { from: "2000-01-01", to: "2100-01-01" });
    const numbers = (summary.json.facts as { numbers: Record<string, number> }).numbers;
    assert.equal(numbers.people, 2);
    assert.equal(numbers.shifts, 2);
    assert.equal(numbers.deviations, 1);
    assert.equal(numbers.refusals, 1);
    assert.equal(numbers.shifts_without_points, 1);
    assert.equal(numbers.anomalies, 2);
    assert.match(String(summary.json.text), /отклонен/);
    assert.match(String(summary.json.text), /аномал/);
    assert.match(String(summary.json.text), /Людей 2/);
    assert.match(String(summary.json.text), /аномалий 2/);
  });

  it("три точки плана кладут GPS на чертёж до полигона", async () => {
    const admin = await token("admin-sub", "admin");
    const worker = await token("worker-a", "worker");
    const personId = await enroll(admin, "worker-a", "Ким Денис Сергеевич");
    await pool.query("INSERT INTO shifts (person_id) VALUES ($1)", [personId]);
    const plans = await api("/plans", "GET", admin);
    const planId = (plans.json.plans as Array<{ id: string; name: string }>).find((plan) => plan.name === "Схема объекта")?.id;
    assert.ok(planId);

    const collinear = await api(`/plans/${planId}/calibration`, "PUT", admin, {
      points: [
        { pixel_x: 0, pixel_y: 0, lat: 0, lon: 0 },
        { pixel_x: 10, pixel_y: 10, lat: 1, lon: 1 },
        { pixel_x: 20, pixel_y: 20, lat: 2, lon: 2 },
      ],
    });
    assert.equal(collinear.status, 400);

    const saved = await api(`/plans/${planId}/calibration`, "PUT", admin, {
      points: [
        { pixel_x: 0, pixel_y: 0, lat: 0, lon: 0 },
        { pixel_x: 100, pixel_y: 0, lat: 0, lon: 1 },
        { pixel_x: 0, pixel_y: 100, lat: 1, lon: 0 },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const loaded = await api(`/plans/${planId}/calibration`, "GET", admin);
    assert.equal((loaded.json.points as unknown[]).length, 3);

    const polygon = await api("/zones/11111111-1111-4111-8111-111111111101/polygon", "PUT", admin, {
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    });
    assert.equal(polygon.status, 200, JSON.stringify(polygon.json));

    const hit = await api("/locations", "POST", worker, { source: "gps", lat: 0.2, lng: 0.3 });
    assert.equal(hit.status, 201, JSON.stringify(hit.json));
    assert.equal(hit.json.zone_id, "11111111-1111-4111-8111-111111111101");

    await pool.query("DELETE FROM plan_calibration_points WHERE plan_id = $1", [planId]);
    await pool.query("UPDATE locations SET recorded_at = now() - interval '5 minutes'");
    const miss = await api("/locations", "POST", worker, { source: "gps", lat: 0.2, lng: 0.3 });
    assert.equal(miss.status, 201, JSON.stringify(miss.json));
    assert.equal(miss.json.zone_id, null);
  });
});
