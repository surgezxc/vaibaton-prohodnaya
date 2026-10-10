import type pg from "pg";
import { requireRoles } from "../auth.js";
import { denyJson } from "../http.js";
import type { ApiApp } from "../types.js";

export function registerMe(app: ApiApp, pool: pg.Pool): void {
  app.get("/me", requireRoles("worker"), async (c) => {
    const { rows } = await pool.query<{
      id: string; full_name: string; shift_id: string | null; started_at: Date | null;
    }>(
      `SELECT p.id, p.full_name, s.id AS shift_id, s.started_at
       FROM people p LEFT JOIN shifts s ON s.person_id = p.id AND s.ended_at IS NULL
       WHERE p.keycloak_sub = $1`,
      [c.get("user").sub],
    );
    const person = rows[0];
    if (!person) return denyJson(c, 422, "Учётка не связана с человеком. Обратитесь к администратору.");
    c.header("Cache-Control", "no-store");
    return c.json({
      person: { id: person.id, full_name: person.full_name },
      shift: person.shift_id && person.started_at ? { shift_id: person.shift_id, started_at: person.started_at.toISOString() } : null,
    });
  });
}
