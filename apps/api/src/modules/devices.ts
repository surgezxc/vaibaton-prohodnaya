import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { denyJson, readJson } from "../http.js";
import { writeJournal } from "../journal.js";
import type { ApiApp } from "../types.js";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: string, hash: string): boolean {
  try {
    const got = createHash("sha256").update(secret).digest();
    const expected = Buffer.from(hash, "hex");
    if (expected.length !== got.length) return false;
    return timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export function registerDevices(app: ApiApp, pool: pg.Pool): void {
  app.post("/devices", requireRoles("worker"), async (c) => {
    const body = (await readJson(c)) ?? {};
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
    const sub = c.get("user").sub;
    const secret = randomBytes(32).toString("base64url");

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
        `INSERT INTO devices (person_id, secret_hash, label) VALUES ($1, $2, $3) RETURNING id`,
        [personId, hashSecret(secret), label],
      );
      const deviceId = inserted.rows[0]?.id;
      if (!deviceId) throw new Error("не удалось привязать телефон");
      await writeJournal(client, {
        personId,
        actorSub: sub,
        what: "привязка телефона",
        reason: "Телефон привязан.",
      });
      return { ok: true as const, deviceId };
    });

    if (!bound.ok) return denyJson(c, 422, bound.error);
    return c.json(
      {
        device_id: bound.deviceId,
        device_secret: secret,
        reason: "Телефон привязан. Секрет показывается один раз.",
        reason_human: "Телефон привязан. Секрет показывается один раз.",
      },
      201,
    );
  });
}
