import type pg from "pg";
import { requireRoles } from "../auth.js";
import { withTx } from "../db.js";
import { countFaces, embedFace, FaceNotReady, FaceResultMissing, normalizeImage } from "./outbound.js";
import { asString, denyJson, isUuid, readJson } from "../http.js";
import { writeJournal } from "../journal.js";
import type { ApiApp } from "../types.js";

type PersonBody = {
  full_name: string | null;
  keycloak_sub: string | null;
  badge_number: string | null;
  position: string | null;
  company: string | null;
  site_name: string | null;
  issuer: string | null;
  valid_until: string | null;
  image_base64: string | null;
};

function readPerson(body: Record<string, unknown>): PersonBody {
  const valid = asString(body.valid_until);
  return {
    full_name: asString(body.full_name),
    keycloak_sub: asString(body.keycloak_sub),
    badge_number: asString(body.badge_number),
    position: asString(body.position),
    company: asString(body.company),
    site_name: asString(body.site_name),
    issuer: asString(body.issuer),
    valid_until: valid && /^\d{4}-\d{2}-\d{2}$/.test(valid) ? valid : valid ? "invalid" : null,
    image_base64: asString(body.image_base64),
  };
}

async function templateFromImage(image: string): Promise<{ embedding: number[] } | { reason: string }> {
  const normalized = normalizeImage(image);
  if (normalized.length < 8 || normalized.length > 8_000_000) {
    return { reason: "Кадр эталона не подходит по размеру." };
  }
  try {
    const count = await countFaces(normalized);
    if (count === 0) return { reason: "На фото нет лица. Эталон не сохранён." };
    if (count >= 2) return { reason: "На фото несколько лиц. Оставьте одного человека." };
    const embedding = await embedFace(normalized);
    return { embedding };
  } catch (error) {
    if (error instanceof FaceNotReady) {
      return { reason: "Распознавание лиц не готово. Эталон не сохранён." };
    }
    if (error instanceof FaceResultMissing) {
      return { reason: "Нет результата проверки лица. Эталон не сохранён." };
    }
    throw error;
  }
}

function personJson(row: {
  id: string;
  full_name: string;
  keycloak_sub: string | null;
  badge_number: string | null;
  position: string | null;
  company: string | null;
  site_name: string | null;
  issuer: string | null;
  valid_until: Date | string | null;
  embedding: unknown;
  status: string;
  inside_since: Date | null;
}) {
  const valid =
    row.valid_until instanceof Date
      ? row.valid_until.toISOString().slice(0, 10)
      : row.valid_until;
  return {
    id: row.id,
    full_name: row.full_name,
    keycloak_sub: row.keycloak_sub,
    badge_number: row.badge_number,
    position: row.position,
    company: row.company,
    site_name: row.site_name,
    issuer: row.issuer,
    valid_until: valid,
    enrolled: Array.isArray(row.embedding) && row.embedding.length > 0,
    status: row.status,
    inside_since: row.inside_since ? row.inside_since.toISOString() : null,
  };
}

const SELECT_PERSON = `
  SELECT p.id, p.full_name, p.keycloak_sub, p.badge_number, p.position, p.company,
         p.site_name, p.issuer, p.valid_until, p.embedding,
         CASE WHEN s.id IS NULL THEN 'вне объекта' ELSE 'на объекте' END AS status,
         s.started_at AS inside_since
  FROM people p
  LEFT JOIN shifts s ON s.person_id = p.id AND s.ended_at IS NULL
`;

export function registerPeople(app: ApiApp, pool: pg.Pool): void {
  app.post("/people", requireRoles("admin"), async (c) => {
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const fields = readPerson(body);
    if (!fields.full_name) return denyJson(c, 400, "Укажите ФИО.");
    if (!fields.keycloak_sub) {
      return denyJson(c, 400, "Укажите учётку Keycloak, с которой связать человека.");
    }
    if (fields.valid_until === "invalid") return denyJson(c, 400, "Дата пропуска в формате ГГГГ-ММ-ДД.");
    if (!fields.image_base64) return denyJson(c, 400, "Нужно фото эталона.");

    const template = await templateFromImage(fields.image_base64);
    const actor = c.get("user").sub;
    if ("reason" in template) {
      await writeJournal(pool, {
        actorSub: actor,
        what: "отказ эталона",
        reason: template.reason,
        decision: "deny",
      });
      const status = template.reason.includes("не готово") ? 503 : 422;
      return denyJson(c, status, template.reason);
    }

    try {
      const created = await withTx(pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO people (
             full_name, keycloak_sub, badge_number, position, company, site_name, issuer, valid_until, embedding
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           RETURNING id`,
          [
            fields.full_name,
            fields.keycloak_sub,
            fields.badge_number,
            fields.position,
            fields.company,
            fields.site_name,
            fields.issuer,
            fields.valid_until,
            JSON.stringify(template.embedding),
          ],
        );
        const id = inserted.rows[0].id;
        await writeJournal(client, {
          personId: id,
          actorSub: actor,
          what: "заведение",
          reason: "Эталон сохранён.",
        });
        const loaded = await client.query(`${SELECT_PERSON} WHERE p.id = $1`, [id]);
        return loaded.rows[0];
      });
      return c.json(personJson(created), 201);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23505") {
        return denyJson(c, 409, "Человек с этой учёткой уже заведён.");
      }
      throw error;
    }
  });

  app.patch("/people/:id", requireRoles("admin"), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return denyJson(c, 404, "Человек не найден.");
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const fields = readPerson(body);
    if (fields.valid_until === "invalid") return denyJson(c, 400, "Дата пропуска в формате ГГГГ-ММ-ДД.");
    if (body.full_name !== undefined && !fields.full_name) return denyJson(c, 400, "Укажите ФИО.");

    let embedding: number[] | undefined;
    if (fields.image_base64) {
      const template = await templateFromImage(fields.image_base64);
      if ("reason" in template) {
        await writeJournal(pool, {
          personId: id,
          actorSub: c.get("user").sub,
          what: "отказ эталона",
          reason: template.reason,
          decision: "deny",
        });
        const status = template.reason.includes("не готово") ? 503 : 422;
        return denyJson(c, status, template.reason);
      }
      embedding = template.embedding;
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.full_name !== undefined) push("full_name", fields.full_name);
    if (body.keycloak_sub !== undefined) push("keycloak_sub", fields.keycloak_sub);
    if (body.badge_number !== undefined) push("badge_number", fields.badge_number);
    if (body.position !== undefined) push("position", fields.position);
    if (body.company !== undefined) push("company", fields.company);
    if (body.site_name !== undefined) push("site_name", fields.site_name);
    if (body.issuer !== undefined) push("issuer", fields.issuer);
    if (body.valid_until !== undefined) push("valid_until", fields.valid_until);
    if (embedding) {
      values.push(JSON.stringify(embedding));
      sets.push(`embedding = $${values.length}::jsonb`);
    }
    if (sets.length === 0) return denyJson(c, 400, "Нет полей для изменения.");
    sets.push("updated_at = now()");
    values.push(id);

    try {
      const updated = await withTx(pool, async (client) => {
        const result = await client.query(
          `UPDATE people SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`,
          values,
        );
        if (!result.rowCount) return null;
        await writeJournal(client, {
          personId: id,
          actorSub: c.get("user").sub,
          what: "правка",
          reason: embedding ? "Эталон обновлён." : "Карточка обновлена.",
        });
        const loaded = await client.query(`${SELECT_PERSON} WHERE p.id = $1`, [id]);
        return loaded.rows[0];
      });
      if (!updated) return denyJson(c, 404, "Человек не найден.");
      return c.json(personJson(updated));
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23505") {
        return denyJson(c, 409, "Человек с этой учёткой уже заведён.");
      }
      throw error;
    }
  });

  app.get("/people", requireRoles("admin", "gate", "manager"), async (c) => {
    const { rows } = await pool.query(`${SELECT_PERSON} ORDER BY p.full_name`);
    return c.json({ people: rows.map((row) => personJson(row)) });
  });
}
