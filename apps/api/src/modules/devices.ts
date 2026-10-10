import { createPublicKey, verify } from "node:crypto";
import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { asString, denyJson, readJson } from "../http.js";
import { writeJournal } from "../journal.js";
import type { ApiApp } from "../types.js";

function spkiFrom(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const key = trimmed.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(trimmed)
      : createPublicKey({ key: Buffer.from(trimmed, "base64"), format: "der", type: "spki" });
    const jwk = key.export({ format: "jwk" }) as { kty?: string; crv?: string };
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
    return key.export({ format: "der", type: "spki" }).toString("base64");
  } catch {
    return null;
  }
}

export function verifyDeviceSignature(publicKeySpki: string, nonce: string, signature: string): boolean {
  if (!publicKeySpki || !nonce || !signature) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
    const payload = Buffer.from(nonce, "utf8");
    const bytes = Buffer.from(signature, "base64url");
    const options = { key, dsaEncoding: "ieee-p1363" as const };
    if (verify("sha256", payload, options, bytes)) return true;
    return verify("sha256", payload, { key, dsaEncoding: "der" }, bytes);
  } catch {
    return false;
  }
}

export function registerDevices(app: ApiApp, pool: pg.Pool): void {
  app.post("/devices", requireRoles("worker"), async (c) => {
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
    const publicKey = spkiFrom(asString(body.public_key) ?? "");
    if (!publicKey) {
      return denyJson(c, 400, "Нужен открытый ключ телефона (ECDSA P-256, SPKI).");
    }
    const sub = c.get("user").sub;

    const bound = await withTx(pool, async (client) => {
      const person = await client.query<{ id: string }>(
        "SELECT id FROM people WHERE keycloak_sub = $1",
        [sub],
      );
      if (!person.rowCount) {
        return { ok: false as const, error: "Учётка не связана с человеком. Обратитесь к администратору." };
      }
      const personId = person.rows[0].id;
      await client.query(
        "UPDATE devices SET revoked_at = now() WHERE person_id = $1 AND revoked_at IS NULL",
        [personId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO devices (person_id, public_key, label) VALUES ($1, $2, $3) RETURNING id`,
        [personId, publicKey, label],
      );
      const deviceId = inserted.rows[0]?.id;
      if (!deviceId) throw new Error("не удалось привязать телефон");
      await writeJournal(client, {
        personId,
        actorSub: sub,
        what: "привязка телефона",
        reason: "Телефон зарегистрировал открытый ключ.",
      });
      return { ok: true as const, deviceId };
    });

    if (!bound.ok) return denyJson(c, 422, bound.error);
    return c.json(
      {
        device_id: bound.deviceId,
        reason: "Телефон привязан. Открытый ключ записан.",
        reason_human: "Телефон привязан. Открытый ключ записан.",
      },
      201,
    );
  });
}
