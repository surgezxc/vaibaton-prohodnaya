import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { parseRing, pointInRing, projectGps, type CalibrationPoint } from "../geo.js";
import { asString, denyJson, readJson, russian } from "../http.js";
import { writeJournal } from "../journal.js";
import type { ApiApp } from "../types.js";

const ZONE_NAMES = new Map<string, string>([
  ["бетон", "Бетон"],
  ["котлован", "Котлован"],
  ["курилка", "Курилка"],
]);

function intervalSeconds(): number {
  const parsed = Number(process.env.LOCATION_INTERVAL_SECONDS ?? "60");
  if (!Number.isFinite(parsed) || parsed < 1) return 60;
  return Math.floor(parsed);
}

export function registerLocations(app: ApiApp, pool: pg.Pool): void {
  app.post("/locations", requireRoles("worker"), async (c) => {
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const source = asString(body.source);
    if (source !== "gps" && source !== "button") {
      return denyJson(c, 400, "Укажите источник: gps или button.");
    }
    const sub = c.get("user").sub;
    const every = intervalSeconds();

    let zoneName: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    if (source === "button") {
      const raw = asString(body.zone_name) ?? asString(body.zone);
      zoneName = raw ? ZONE_NAMES.get(raw.toLowerCase()) ?? null : null;
      if (!zoneName) return denyJson(c, 400, "Неизвестная зона. Доступны Бетон, Котлован и Курилка.");
    } else {
      if (typeof body.lat !== "number" || typeof body.lng !== "number" || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
        return denyJson(c, 400, "Нужны координаты lat и lng.");
      }
      lat = body.lat;
      lng = body.lng;
    }

    const saved = await withTx(pool, async (client) => {
      const person = await client.query<{ id: string }>("SELECT id FROM people WHERE keycloak_sub = $1", [sub]);
      if (!person.rowCount) {
        return {
          ok: false as const,
          error: "Учётка не связана с человеком. Обратитесь к администратору.",
          status: 422 as const,
        };
      }
      const personId = person.rows[0].id;
      const shift = await client.query<{ id: string }>(
        `SELECT id FROM shifts WHERE person_id = $1 AND ended_at IS NULL FOR UPDATE`,
        [personId],
      );
      if (!shift.rowCount) {
        const reason = "Смена закрыта. Координаты больше не принимаются.";
        await writeJournal(client, {
          personId,
          actorSub: sub,
          what: "отказ координат",
          reason,
          decision: "deny",
        });
        return { ok: false as const, error: reason, status: 422 as const };
      }
      const shiftId = shift.rows[0].id;

      if (source === "gps") {
        const last = await client.query<{ fresh: boolean }>(
          `SELECT (recorded_at > now() - ($2::text || ' seconds')::interval) AS fresh
           FROM locations
           WHERE shift_id = $1 AND source = 'gps'
           ORDER BY recorded_at DESC
           LIMIT 1`,
          [shiftId, String(every)],
        );
        if (last.rows[0]?.fresh) {
          return { ok: false as const, error: `Координаты принимаются раз в ${every} секунд.`, status: 422 as const };
        }
      }

      let zoneId: string | null = null;
      if (zoneName) {
        const zone = await client.query<{ id: string }>("SELECT id FROM zones WHERE name = $1", [zoneName]);
        zoneId = zone.rows[0]?.id ?? null;
      } else if (lat !== null && lng !== null) {
        const stored = await client.query<{
          plan_id: string;
          pixel_x: number;
          pixel_y: number;
          lat: number;
          lon: number;
        }>(
          `SELECT plan_id, pixel_x, pixel_y, lat, lon
           FROM plan_calibration_points
           ORDER BY plan_id, idx`,
        );
        const byPlan = new Map<string, CalibrationPoint[]>();
        for (const row of stored.rows) {
          const list = byPlan.get(row.plan_id) ?? [];
          list.push({ pixel_x: row.pixel_x, pixel_y: row.pixel_y, lat: row.lat, lon: row.lon });
          byPlan.set(row.plan_id, list);
        }
        const zones = await client.query<{ id: string; plan_id: string | null; polygon: unknown }>(
          "SELECT id, plan_id, polygon FROM zones ORDER BY name",
        );
        for (const [planId, points] of byPlan) {
          if (points.length !== 3) continue;
          const pixel = projectGps(points, lat, lng);
          if (!pixel) continue;
          for (const zone of zones.rows) {
            if (zone.plan_id !== planId) continue;
            const ring = parseRing(zone.polygon);
            if (ring && pointInRing(pixel.x, pixel.y, ring)) {
              zoneId = zone.id;
              break;
            }
          }
          if (zoneId) break;
        }
      }

      const inserted = await client.query<{ id: string; recorded_at: Date }>(
        `INSERT INTO locations (shift_id, zone_id, lat, lng, source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, recorded_at`,
        [shiftId, zoneId, lat, lng, source],
      );

      if (zoneId) {
        const openVisit = await client.query<{ id: string; zone_id: string }>(
          `SELECT id, zone_id FROM visits
           WHERE shift_id = $1 AND ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
           FOR UPDATE`,
          [shiftId],
        );
        const current = openVisit.rows[0];
        if (!current) {
          await client.query(
            `INSERT INTO visits (shift_id, zone_id) VALUES ($1, $2)`,
            [shiftId, zoneId],
          );
        } else if (current.zone_id !== zoneId) {
          await client.query("UPDATE visits SET ended_at = now() WHERE id = $1", [current.id]);
          await client.query(
            `INSERT INTO visits (shift_id, zone_id) VALUES ($1, $2)`,
            [shiftId, zoneId],
          );
        }
      } else {
        await client.query(
          "UPDATE visits SET ended_at = now() WHERE shift_id = $1 AND ended_at IS NULL",
          [shiftId],
        );
      }

      const locationId = inserted.rows[0]?.id;
      const recordedAt = inserted.rows[0]?.recorded_at;
      if (!locationId || !recordedAt) throw new Error("не удалось записать точку");
      return {
        ok: true as const,
        id: locationId,
        recorded_at: recordedAt,
        zoneId,
        shiftId,
      };
    });

    if (!saved.ok) return denyJson(c, saved.status, saved.error);
    return c.json({
      ...russian("Точка записана в открытую смену."),
      location_id: saved.id,
      shift_id: saved.shiftId,
      zone_id: saved.zoneId,
      recorded_at: saved.recorded_at.toISOString(),
      source,
    }, 201);
  });
}
