import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { calibrationUsable, parseCalibration, type CalibrationPoint } from "../geo.js";
import { denyJson, isUuid, readJson, russian } from "../http.js";
import type { ApiApp } from "../types.js";

type PointRow = {
  idx: number;
  pixel_x: number;
  pixel_y: number;
  lat: number;
  lon: number;
};

function pointJson(row: PointRow) {
  return {
    pixel_x: row.pixel_x,
    pixel_y: row.pixel_y,
    lat: row.lat,
    lon: row.lon,
  };
}

async function readPoints(pool: pg.Pool, planId: string): Promise<PointRow[]> {
  const { rows } = await pool.query<PointRow>(
    `SELECT idx, pixel_x, pixel_y, lat, lon
     FROM plan_calibration_points
     WHERE plan_id = $1
     ORDER BY idx`,
    [planId],
  );
  return rows;
}

export function registerPlans(app: ApiApp, pool: pg.Pool): void {
  app.get("/plans", requireRoles("admin", "manager"), async (c) => {
    const { rows } = await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM plans ORDER BY name",
    );
    const plans = [];
    for (const plan of rows) {
      plans.push({ id: plan.id, name: plan.name, points: (await readPoints(pool, plan.id)).map(pointJson) });
    }
    return c.json({ plans });
  });

  app.get("/plans/:id/calibration", requireRoles("admin", "manager"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "План не найден.");
    const plan = await pool.query<{ id: string; name: string }>("SELECT id, name FROM plans WHERE id = $1", [id]);
    if (!plan.rowCount) return denyJson(c, 404, "План не найден.");
    return c.json({
      id: plan.rows[0].id,
      name: plan.rows[0].name,
      points: (await readPoints(pool, id)).map(pointJson),
    });
  });

  app.put("/plans/:id/calibration", requireRoles("admin"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "План не найден.");
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const points = parseCalibration(body.points);
    if (!points) return denyJson(c, 400, "Нужны ровно три точки: pixel_x, pixel_y, lat, lon.");
    if (!calibrationUsable(points)) {
      return denyJson(c, 400, "Три точки не должны лежать на одной прямой.");
    }

    const saved = await withTx(pool, async (client) => {
      const plan = await client.query("SELECT 1 FROM plans WHERE id = $1 FOR UPDATE", [id]);
      if (!plan.rowCount) return false;
      await client.query("DELETE FROM plan_calibration_points WHERE plan_id = $1", [id]);
      for (const [index, point] of points.entries()) {
        await client.query(
          `INSERT INTO plan_calibration_points (plan_id, idx, pixel_x, pixel_y, lat, lon)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, index, point.pixel_x, point.pixel_y, point.lat, point.lon],
        );
      }
      await client.query("UPDATE plans SET updated_at = now() WHERE id = $1", [id]);
      return true;
    });
    if (!saved) return denyJson(c, 404, "План не найден.");
    return c.json({
      ...russian("Точки привязки сохранены."),
      id,
      points: points.map((point: CalibrationPoint) => ({
        pixel_x: point.pixel_x,
        pixel_y: point.pixel_y,
        lat: point.lat,
        lon: point.lon,
      })),
    });
  });
}
