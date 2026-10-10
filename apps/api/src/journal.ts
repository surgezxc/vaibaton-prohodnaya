import type pg from "pg";
import { requireRoles } from "./auth.js";
import type { Db } from "./db.js";
import { denyJson, isUuid } from "./http.js";
import type { ApiApp, ReasonCode } from "./types.js";

export type JournalInput = {
  personId?: string | null;
  actorSub?: string | null;
  what: string;
  direction?: string | null;
  decision?: "allow" | "deny" | null;
  reason: string;
  attemptId?: string | null;
  reasonCode?: ReasonCode | null;
  factors?: Record<string, unknown>;
};

export async function writeJournal(db: Db, input: JournalInput): Promise<void> {
  const factors = {
    ...(input.factors ?? {}),
    ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
  };
  await db.query(
    `INSERT INTO journal (person_id, actor_sub, what, direction, decision, reason, attempt_id, factors)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.personId ?? null,
      input.actorSub ?? null,
      input.what,
      input.direction ?? null,
      input.decision ?? null,
      input.reason,
      input.attemptId ?? null,
      JSON.stringify(factors),
    ],
  );
}

export function registerJournal(app: ApiApp, pool: pg.Pool): void {
  app.get("/journal", requireRoles("admin", "manager", "gate"), async (c) => {
    const url = new URL(c.req.url);
    const personId = url.searchParams.get("person_id");
    if (personId && !isUuid(personId)) {
      return denyJson(c, 400, "Некорректный идентификатор человека.");
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100;
    const decision = url.searchParams.get("decision");
    if (decision && decision !== "allow" && decision !== "deny") {
      return denyJson(c, 400, "Решение в фильтре: allow или deny.");
    }

    const { rows } = await pool.query<{
      id: string;
      at: Date;
      person_id: string | null;
      full_name: string | null;
      actor_sub: string | null;
      what: string;
      direction: string | null;
      decision: string | null;
      reason: string | null;
      attempt_id: string | null;
    }>(
      `SELECT j.id, j.at, j.person_id, p.full_name, j.actor_sub, j.what, j.direction,
              j.decision, j.reason, j.attempt_id
       FROM journal j
       LEFT JOIN people p ON p.id = j.person_id
       WHERE ($1::uuid IS NULL OR j.person_id = $1)
         AND ($2::text IS NULL OR j.decision = $2)
       ORDER BY j.at DESC
       LIMIT $3`,
      [personId, decision, limit],
    );

    return c.json({
      journal: rows.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        person_id: row.person_id,
        full_name: row.full_name,
        actor_sub: row.actor_sub,
        what: row.what,
        direction: row.direction,
        decision: row.decision,
        reason: row.reason,
        reason_human: row.reason,
        attempt_id: row.attempt_id,
      })),
    });
  });
}
