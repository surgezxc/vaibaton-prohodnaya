import type pg from "pg";
import { requireRoles } from "../auth.js";
import { denyJson, isUuid } from "../http.js";
import type { ApiApp } from "../types.js";

export type Filters = {
  from: string | null;
  to: string | null;
  hourFrom: number | null;
  hourTo: number | null;
  personIds: string[] | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(url: URL): Filters | { error: string } {
  const day = url.searchParams.get("day");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (day && !DATE_RE.test(day)) return { error: "Некорректная дата." };
  if (from && !DATE_RE.test(from)) return { error: "Некорректная дата." };
  if (to && !DATE_RE.test(to)) return { error: "Некорректная дата." };

  const hour = (name: string): number | null | { error: string } => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 23) return { error: "Час должен быть от 0 до 23." };
    return value;
  };
  const hourFrom = hour("hour_from");
  if (hourFrom && typeof hourFrom === "object") return hourFrom;
  const hourTo = hour("hour_to");
  if (hourTo && typeof hourTo === "object") return hourTo;

  const ids = url.searchParams
    .getAll("person_id")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.some((id) => !isUuid(id))) return { error: "Некорректный идентификатор человека." };

  return {
    from: day ?? from,
    to: day ?? to,
    hourFrom: typeof hourFrom === "number" ? hourFrom : null,
    hourTo: typeof hourTo === "number" ? hourTo : null,
    personIds: ids.length > 0 ? ids : null,
  };
}

function filterJson(filters: Filters) {
  return {
    from: filters.from,
    to: filters.to,
    hour_from: filters.hourFrom,
    hour_to: filters.hourTo,
    person_id: filters.personIds,
  };
}

const VISIT_WHERE = `
  ($1::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
  AND ($2::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
  AND ($3::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int >= $3)
  AND ($4::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int <= $4)
  AND ($5::uuid[] IS NULL OR s.person_id = ANY($5::uuid[]))
`;

function filterParams(filters: Filters): unknown[] {
  return [filters.from, filters.to, filters.hourFrom, filters.hourTo, filters.personIds];
}

export function registerAnalytics(app: ApiApp, pool: pg.Pool): void {
  app.get("/site/now", requireRoles("manager", "admin", "gate"), async (c) => {
    const { rows } = await pool.query<{
      person_id: string;
      full_name: string;
      shift_id: string;
      started_at: Date;
    }>(
      `SELECT p.id AS person_id, p.full_name, s.id AS shift_id, s.started_at
       FROM shifts s
       JOIN people p ON p.id = s.person_id
       WHERE s.ended_at IS NULL
       ORDER BY s.started_at`,
    );
    return c.json({
      inside: rows.map((row) => ({
        person_id: row.person_id,
        full_name: row.full_name,
        shift_id: row.shift_id,
        started_at: row.started_at.toISOString(),
      })),
    });
  });

  app.get("/analytics/heat", requireRoles("manager", "admin"), async (c) => {
    const filters = parseFilters(new URL(c.req.url));
    if ("error" in filters) return denyJson(c, 400, filters.error);
    const { rows } = await pool.query<{
      id: string;
      name: string;
      photo_id: string | null;
      polygon: unknown;
      control_points: unknown;
      visits: number;
    }>(
      `SELECT z.id, z.name, z.photo_id, z.polygon, z.control_points,
              COALESCE(c.visits, 0)::int AS visits
       FROM zones z
       LEFT JOIN (
         SELECT v.zone_id, COUNT(*)::int AS visits
         FROM visits v
         JOIN shifts s ON s.id = v.shift_id
         WHERE ${VISIT_WHERE}
         GROUP BY v.zone_id
       ) c ON c.zone_id = z.id
       ORDER BY z.name`,
      filterParams(filters),
    );
    return c.json({
      metric: "посещения",
      filters: filterJson(filters),
      zones: rows.map((row) => ({
        id: row.id,
        name: row.name,
        photo_id: row.photo_id,
        polygon: row.polygon,
        control_points: row.control_points,
        visits: row.visits,
        empty: row.visits === 0,
      })),
    });
  });

  app.get("/analytics/routes", requireRoles("manager", "admin"), async (c) => {
    const filters = parseFilters(new URL(c.req.url));
    if ("error" in filters) return denyJson(c, 400, filters.error);
    const params = filterParams(filters);
    const { rows } = await pool.query<{
      person_id: string;
      full_name: string;
      visits: unknown;
      points: unknown;
    }>(
      `WITH people_in AS (
         SELECT DISTINCT s.person_id
         FROM locations l
         JOIN shifts s ON s.id = l.shift_id
         WHERE ($1::date IS NULL OR (l.recorded_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
           AND ($2::date IS NULL OR (l.recorded_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
           AND ($3::int IS NULL OR EXTRACT(HOUR FROM l.recorded_at AT TIME ZONE 'Europe/Moscow')::int >= $3)
           AND ($4::int IS NULL OR EXTRACT(HOUR FROM l.recorded_at AT TIME ZONE 'Europe/Moscow')::int <= $4)
           AND ($5::uuid[] IS NULL OR s.person_id = ANY($5::uuid[]))
       )
       SELECT p.id AS person_id, p.full_name,
         COALESCE((
           SELECT json_agg(json_build_object(
             'zone_id', v.zone_id,
             'zone_name', z.name,
             'started_at', v.started_at,
             'ended_at', v.ended_at
           ) ORDER BY v.started_at)
           FROM visits v
           JOIN shifts s ON s.id = v.shift_id
           JOIN zones z ON z.id = v.zone_id
           WHERE s.person_id = p.id AND ${VISIT_WHERE}
         ), '[]'::json) AS visits,
         COALESCE((
           SELECT json_agg(json_build_object(
             'at', l.recorded_at,
             'lat', l.lat,
             'lng', l.lng,
             'zone_id', l.zone_id,
             'zone_name', z.name,
             'source', l.source
           ) ORDER BY l.recorded_at)
           FROM locations l
           JOIN shifts s ON s.id = l.shift_id
           LEFT JOIN zones z ON z.id = l.zone_id
           WHERE s.person_id = p.id
             AND ($1::date IS NULL OR (l.recorded_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
             AND ($2::date IS NULL OR (l.recorded_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
             AND ($3::int IS NULL OR EXTRACT(HOUR FROM l.recorded_at AT TIME ZONE 'Europe/Moscow')::int >= $3)
             AND ($4::int IS NULL OR EXTRACT(HOUR FROM l.recorded_at AT TIME ZONE 'Europe/Moscow')::int <= $4)
         ), '[]'::json) AS points
       FROM people_in pi
       JOIN people p ON p.id = pi.person_id
       ORDER BY p.full_name`,
      params,
    );
    return c.json({
      metric: "посещения",
      filters: filterJson(filters),
      empty: rows.length === 0,
      note: rows.length === 0 ? "Данных нет." : null,
      people: rows,
    });
  });

  app.get("/analytics/reports", requireRoles("manager", "admin"), async (c) => {
    const filters = parseFilters(new URL(c.req.url));
    if ("error" in filters) return denyJson(c, 400, filters.error);
    const params = filterParams(filters);
    const byShift = await pool.query(
      `SELECT s.id AS shift_id, s.person_id, p.full_name, s.started_at, s.ended_at, s.duration_seconds,
              COALESCE((
                SELECT json_agg(json_build_object('zone_id', g.zone_id, 'zone_name', g.zone_name, 'count', g.count) ORDER BY g.zone_name)
                FROM (
                  SELECT v.zone_id, z.name AS zone_name, COUNT(*)::int AS count
                  FROM visits v
                  JOIN zones z ON z.id = v.zone_id
                  WHERE v.shift_id = s.id
                    AND ($1::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
                    AND ($2::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
                    AND ($3::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int >= $3)
                    AND ($4::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int <= $4)
                  GROUP BY v.zone_id, z.name
                ) g
              ), '[]'::json) AS visits
       FROM shifts s
       JOIN people p ON p.id = s.person_id
       WHERE ($1::date IS NULL OR (s.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
         AND ($2::date IS NULL OR (s.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
         AND ($5::uuid[] IS NULL OR s.person_id = ANY($5::uuid[]))
       ORDER BY s.started_at`,
      params,
    );
    const byPerson = await pool.query(
      `SELECT p.id AS person_id, p.full_name,
              COUNT(DISTINCT s.id)::int AS shift_count,
              COALESCE(SUM(
                COALESCE(
                  s.duration_seconds,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))::int)
                )
              ), 0)::int AS duration_seconds,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'zone_id', g.zone_id, 'zone_name', g.zone_name, 'count', g.count
                ) ORDER BY g.zone_name)
                FROM (
                  SELECT v.zone_id, z.name AS zone_name, COUNT(*)::int AS count
                  FROM visits v
                  JOIN shifts s2 ON s2.id = v.shift_id
                  JOIN zones z ON z.id = v.zone_id
                  WHERE s2.person_id = p.id
                    AND ($1::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
                    AND ($2::date IS NULL OR (v.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
                    AND ($3::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int >= $3)
                    AND ($4::int IS NULL OR EXTRACT(HOUR FROM v.started_at AT TIME ZONE 'Europe/Moscow')::int <= $4)
                  GROUP BY v.zone_id, z.name
                ) g
              ), '[]'::json) AS visits
       FROM shifts s
       JOIN people p ON p.id = s.person_id
       WHERE ($1::date IS NULL OR (s.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date)
         AND ($2::date IS NULL OR (s.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date)
         AND ($5::uuid[] IS NULL OR s.person_id = ANY($5::uuid[]))
       GROUP BY p.id, p.full_name
       ORDER BY p.full_name`,
      params,
    );
    return c.json({
      metric: "посещения",
      filters: filterJson(filters),
      empty: byShift.rows.length === 0,
      note: byShift.rows.length === 0 ? "Данных нет." : null,
      by_shift: byShift.rows,
      by_person: byPerson.rows,
    });
  });
}
