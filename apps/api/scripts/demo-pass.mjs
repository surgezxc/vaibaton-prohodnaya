// Живой проход стенда: токены Keycloak, подпись nonce, decide без сервиса лиц, повтор QR.
// Запуск из apps/api: node scripts/demo-pass.mjs
//
// POST /people без face отвечает 503 и эталон не пишет. decide зовёт лицо только если
// embedding уже есть, иначе отказ «эталон не сохранён» и до face дело не доходит.
// Поэтому человеку worker кладётся заглушка [0]. Это не вектор модели.

import { generateKeyPairSync, sign } from "node:crypto";
import pg from "pg";

const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://127.0.0.1:8081";
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://prohodnaya:change-me@127.0.0.1:5432/prohodnaya";
const password = process.env.DEMO_PASSWORD ?? "dev-only";
const workerName = "Гаджиев Магомед Ибрагимович";

async function token(username) {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "web",
    username,
    password,
  });
  const response = await fetch(`${keycloakUrl}/realms/prohodnaya/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json();
  if (!json.access_token) {
    throw new Error(`Keycloak ${username}: ${response.status} ${JSON.stringify(json)}`);
  }
  const payload = JSON.parse(Buffer.from(json.access_token.split(".")[1], "base64url").toString());
  return { access: json.access_token, sub: payload.sub };
}

async function api(pathname, method, bearer, body) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function deviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey,
  };
}

function signatureFor(privateKey, nonce) {
  return sign("sha256", Buffer.from(nonce, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

async function ensureWorker(workerSub) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const linked = await client.query("SELECT id FROM people WHERE keycloak_sub = $1", [workerSub]);
    let personId = linked.rows[0]?.id;
    if (!personId) {
      const named = await client.query(
        `SELECT id FROM people
         WHERE full_name = $1 AND keycloak_sub IS NULL
         ORDER BY created_at
         LIMIT 1`,
        [workerName],
      );
      if (named.rowCount) {
        personId = named.rows[0].id;
        await client.query("UPDATE people SET keycloak_sub = $2 WHERE id = $1", [personId, workerSub]);
      } else {
        const inserted = await client.query(
          `INSERT INTO people (
             full_name, keycloak_sub, badge_number, position, company, site_name, issuer, valid_until, embedding
           ) VALUES ($1, $2, '314', 'арматурщик', 'ООО «МонолитПодряд»', 'ЖК Северный', 'СтройГрад-Тест', '2027-12-31', '[0]'::jsonb)
           RETURNING id`,
          [workerName, workerSub],
        );
        personId = inserted.rows[0].id;
      }
    }
    await client.query(
      `UPDATE people
       SET embedding = '[0]'::jsonb
       WHERE id = $1
         AND (embedding IS NULL OR jsonb_typeof(embedding) IS DISTINCT FROM 'array' OR jsonb_array_length(embedding) < 1)`,
      [personId],
    );
    return personId;
  } finally {
    await client.end();
  }
}

function stop(step, response) {
  console.error(step, response.status, JSON.stringify(response.json));
  process.exit(1);
}

const gate = await token("gate");
const worker = await token("worker");
const personId = await ensureWorker(worker.sub);
const device = deviceKey();

const bound = await api("/devices", "POST", worker.access, { public_key: device.spki, label: "телефон демо" });
if (bound.status !== 201) stop("привязка", bound);

const opened = await api("/attempts", "POST", gate.access, { direction: "in" });
if (opened.status !== 201) stop("попытка", opened);
const attemptId = opened.json.attempt_id;
const nonce = opened.json.nonce;
const signature = signatureFor(device.privateKey, nonce);

const scanned = await api(`/attempts/${attemptId}/scan`, "POST", worker.access, { nonce, signature });
if (scanned.json.confirmed !== true) stop("скан", scanned);

const decided = await api(`/attempts/${attemptId}/decide`, "POST", gate.access, {
  nonce,
  image_base64: "aW1hZ2U=",
});
const qrReplay = await api(`/attempts/${attemptId}/scan`, "POST", worker.access, { nonce, signature });
const decideReplay = await api(`/attempts/${attemptId}/decide`, "POST", gate.access, {
  nonce,
  image_base64: "aW1hZ2U=",
});

const journal = await api(`/journal?decision=deny&limit=20`, "GET", gate.access);
const rows = Array.isArray(journal.json.journal)
  ? journal.json.journal.filter((row) => row.attempt_id === attemptId)
  : [];

console.log("person", personId);
console.log("decide", decided.status, JSON.stringify(decided.json));
console.log("qr_replay", qrReplay.status, JSON.stringify(qrReplay.json));
console.log("decide_replay", decideReplay.status, JSON.stringify(decideReplay.json));
console.log("journal", JSON.stringify(rows));

if (decided.json.decision !== "deny" || !String(decided.json.reason).includes("не готово")) {
  stop("ожидался отказ «не готово»", decided);
}
if (qrReplay.json.confirmed !== false || qrReplay.json.reason_code !== "PROOF_REPLAY") {
  stop("повтор QR не отказан", qrReplay);
}
if (decideReplay.json.decision !== "deny" || decideReplay.json.reason_code !== "REPLAY") {
  stop("повтор decide не REPLAY", decideReplay);
}
if (!rows.some((row) => String(row.reason).includes("не готово"))) {
  stop("журнал не записал отказ", { status: journal.status, json: journal.json });
}
