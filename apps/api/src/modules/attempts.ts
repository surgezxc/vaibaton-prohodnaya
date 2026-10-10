import { randomBytes } from "node:crypto";
import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { asString, denyJson, isUuid, readJson, russian } from "../http.js";
import { writeJournal } from "../journal.js";
import type { ApiApp, Direction } from "../types.js";
import { verifyDeviceSignature } from "./devices.js";
import { decidePass } from "./decide.js";

function parseDirection(value: unknown): Direction | null {
  if (value === "in" || value === "вход") return "in";
  if (value === "out" || value === "выход") return "out";
  return null;
}

function ttlSeconds(): number {
  const parsed = Number(process.env.ATTEMPT_TTL_SECONDS ?? "25");
  if (!Number.isFinite(parsed) || parsed < 5) return 25;
  return Math.floor(parsed);
}

export function registerAttempts(app: ApiApp, pool: pg.Pool): void {
  app.get("/attempts/:id", requireRoles("gate", "worker"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Попытка не найдена.");
    const user = c.get("user");
    const { rows } = await pool.query<{
      id: string; direction: string; status: string; expires_at: Date;
      stale: boolean; decision: "allow" | "deny" | null; reason: string | null;
    }>(
      `SELECT a.id, a.direction, a.status, a.expires_at, a.decision, a.reason,
              (a.expires_at <= now()) AS stale
       FROM attempts a LEFT JOIN people p ON p.id = a.person_id
       WHERE a.id = $1 AND (($2::boolean AND a.gate_sub = $4) OR ($3::boolean AND p.keycloak_sub = $4))`,
      [id, user.roles.includes("gate"), user.roles.includes("worker"), user.sub],
    );
    const attempt = rows[0];
    if (!attempt) return denyJson(c, 404, "Попытка не найдена.");
    const expired = attempt.stale && ["pending", "scanned"].includes(attempt.status);
    c.header("Cache-Control", "no-store");
    return c.json({
      attempt_id: attempt.id, direction: attempt.direction,
      status: expired ? "expired" : attempt.status,
      expires_at: attempt.expires_at.toISOString(), decision: attempt.decision,
      reason_human: expired ? "QR устарел. Откройте новый код на планшете." : attempt.reason,
    });
  });

  app.post("/attempts", requireRoles("gate"), async (c) => {
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const direction = parseDirection(body.direction);
    if (!direction) return denyJson(c, 400, "Укажите направление: вход или выход.");
    const gateSub = c.get("user").sub;
    const nonce = randomBytes(24).toString("base64url");

    const created = await withTx(pool, async (client) => {
      const replaced = await client.query<{ id: string; person_id: string | null; direction: string }>(
        `UPDATE attempts
         SET status = 'cancelled',
             used = true,
             reason = 'Предыдущий код заменён новым QR.'
         WHERE gate_sub = $1 AND status IN ('pending', 'scanned')
         RETURNING id, person_id, direction`,
        [gateSub],
      );
      for (const row of replaced.rows) {
        await writeJournal(client, {
          personId: row.person_id,
          actorSub: gateSub,
          what: "отмена",
          direction: row.direction,
          reason: "Предыдущий код заменён новым QR.",
          attemptId: row.id,
          reasonCode: "EXPIRED",
        });
      }
      const inserted = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO attempts (direction, nonce, expires_at, status, gate_sub)
         VALUES ($1, $2, now() + ($3::text || ' seconds')::interval, 'pending', $4)
         RETURNING id, expires_at`,
        [direction, nonce, String(ttlSeconds()), gateSub],
      );
      return inserted.rows[0];
    });

    return c.json(
      {
        attempt_id: created.id,
        nonce,
        expires_at: created.expires_at.toISOString(),
        direction,
      },
      201,
    );
  });

  // Отмена только явным запросом: клиент закрыл экран и ещё достучался до API.
  // Обрыв websocket или wifi сюда не приводит. Молчащий клиент гасит ttl.
  app.post("/attempts/:id/cancel", requireRoles("gate"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Попытка не найдена.");
    const gateSub = c.get("user").sub;
    const reason = "Код отменён. Откройте QR заново.";
    const cancelled = await withTx(pool, async (client) => {
      const updated = await client.query<{ person_id: string | null; direction: string }>(
        `UPDATE attempts
         SET status = 'cancelled', used = true, reason = $2
         WHERE id = $1 AND gate_sub = $3 AND status IN ('pending', 'scanned')
         RETURNING person_id, direction`,
        [id, reason, gateSub],
      );
      if (!updated.rowCount) return null;
      await writeJournal(client, {
        personId: updated.rows[0].person_id,
        actorSub: gateSub,
        what: "отмена",
        direction: updated.rows[0].direction,
        reason,
        attemptId: id,
        reasonCode: "EXPIRED",
      });
      return true;
    });
    if (!cancelled) {
      const exists = await pool.query("SELECT 1 FROM attempts WHERE id = $1 AND gate_sub = $2", [id, gateSub]);
      if (!exists.rowCount) return denyJson(c, 404, "Попытка не найдена.");
      return denyJson(c, 409, "Попытка уже завершена.");
    }
    return c.json(russian(reason));
  });

  app.post("/attempts/:id/scan", requireRoles("worker"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Попытка не найдена.");
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const sub = c.get("user").sub;
    const nonce = asString(body.nonce);
    const signature = asString(body.signature);

    const result = await withTx(pool, async (client) => {
      const locked = await client.query<{
        id: string;
        nonce: string;
        status: string;
        used: boolean;
        stale: boolean;
        direction: string;
        person_id: string | null;
      }>(
        `SELECT id, nonce, status, used, direction, person_id, (expires_at <= now()) AS stale
         FROM attempts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const attempt = locked.rows[0];
      if (!attempt) return { http: 404 as const, reason: "Попытка не найдена." };

      const fail = async (reason: string, code: "EXPIRED" | "PROOF_MISSING" | "PROOF_REPLAY" | "PROOF_FOREIGN" | "NO_SUCH_PERSON") => {
        await writeJournal(client, {
          personId: attempt.person_id,
          actorSub: sub,
          what: "отказ",
          direction: attempt.direction,
          decision: "deny",
          reason,
          attemptId: attempt.id,
          reasonCode: code,
        });
        return { http: 200 as const, confirmed: false, reason, code };
      };

      if (attempt.used || attempt.status === "decided" || attempt.status === "cancelled") {
        return fail(
          attempt.status === "cancelled"
            ? "Код отменён. Откройте QR заново."
            : "Этот код уже использован. Повторный проход невозможен.",
          attempt.status === "cancelled" ? "EXPIRED" : "PROOF_REPLAY",
        );
      }
      if (attempt.stale) return fail("QR устарел. Откройте новый код на планшете.", "EXPIRED");
      if (!nonce || nonce !== attempt.nonce) return fail("Код не совпадает с этой попыткой.", "PROOF_MISSING");
      if (attempt.status === "scanned") {
        return fail("Этот код уже подтверждён телефоном.", "PROOF_REPLAY");
      }

      const person = await client.query<{ id: string }>("SELECT id FROM people WHERE keycloak_sub = $1", [sub]);
      if (!person.rowCount) {
        return fail("Учётка не связана с человеком. Обратитесь к администратору.", "NO_SUCH_PERSON");
      }
      const personId = person.rows[0].id;
      const device = await client.query<{ id: string; public_key: string | null }>(
        `SELECT id, public_key FROM devices
         WHERE person_id = $1 AND revoked_at IS NULL
         ORDER BY bound_at DESC
         LIMIT 1`,
        [personId],
      );
      const publicKey = device.rows[0]?.public_key ?? null;
      if (!device.rowCount || !publicKey || !verifyDeviceSignature(publicKey, attempt.nonce, signature ?? "")) {
        return fail("Чужое устройство.", "PROOF_FOREIGN");
      }

      await client.query(
        `UPDATE attempts
         SET status = 'scanned', person_id = $2, device_id = $3
         WHERE id = $1`,
        [attempt.id, personId, device.rows[0].id],
      );
      await writeJournal(client, {
        personId,
        actorSub: sub,
        what: "подтверждение телефона",
        direction: attempt.direction,
        reason: "Телефон подтвердил попытку.",
        attemptId: attempt.id,
      });
      return { http: 200 as const, confirmed: true, reason: "Телефон подтвердил попытку." };
    });

    if (result.http === 404) return denyJson(c, 404, result.reason);
    return c.json({
      confirmed: result.confirmed,
      reason: result.reason,
      reason_human: result.reason,
      ...("code" in result && result.code ? { reason_code: result.code } : {}),
    });
  });

  app.post("/attempts/:id/decide", requireRoles("gate"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Попытка не найдена.");
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    // person_id, allowed и decision из тела не читаем: личность уже записана при scan из sub.
    const decided = await decidePass(pool, {
      attemptId: id,
      gateSub: c.get("user").sub,
      nonce: asString(body.nonce),
      imageBase64: asString(body.image_base64),
    });
    return c.json(decided.body, decided.http);
  });
}
