import type pg from "pg";
import { requireRoles } from "../auth.js";
import { parseControlPoints, parseRing } from "../geo.js";
import { denyJson, isUuid, readJson, russian } from "../http.js";
import type { ApiApp } from "../types.js";

export function registerZones(app: ApiApp, pool: pg.Pool): void {
  app.put("/zones/:id/polygon", requireRoles("admin"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Зона не найдена.");
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const hasPolygon = body.polygon !== undefined;
    const hasPoints = body.control_points !== undefined;
    if (!hasPolygon && !hasPoints) {
      return denyJson(c, 400, "Передайте полигон или три контрольные точки.");
    }

    let polygonJson: string | null = null;
    if (hasPolygon) {
      const ring = parseRing(body.polygon);
      if (!ring) return denyJson(c, 400, "Полигон должен содержать не меньше трёх точек.");
      polygonJson = JSON.stringify(ring);
    }
    let pointsJson: string | null = null;
    if (hasPoints) {
      const points = parseControlPoints(body.control_points);
      if (!points) return denyJson(c, 400, "Нужны три контрольные точки привязки.");
      pointsJson = JSON.stringify(points);
    }

    const exists = await pool.query("SELECT 1 FROM zones WHERE id = $1", [id]);
    if (!exists.rowCount) return denyJson(c, 404, "Зона не найдена.");

    const updated = await pool.query<{
      id: string;
      name: string;
      photo_id: string | null;
      polygon: unknown;
      control_points: unknown;
    }>(
      `UPDATE zones
       SET polygon = COALESCE($2::jsonb, polygon),
           control_points = COALESCE($3::jsonb, control_points),
           updated_at = now()
       WHERE id = $1
       RETURNING id, name, photo_id, polygon, control_points`,
      [id, polygonJson, pointsJson],
    );
    const zone = updated.rows[0];
    return c.json({
      ...russian("Границы зоны сохранены."),
      id: zone.id,
      name: zone.name,
      photo_id: zone.photo_id,
      polygon: zone.polygon,
      control_points: zone.control_points,
    });
  });
}
