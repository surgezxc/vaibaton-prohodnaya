import type pg from "pg";
import { requireRoles } from "../auth.js";
import { asString, denyJson, readJson } from "../http.js";
import { writeJournal } from "../journal.js";
import { completeText, formulatePrompt } from "./outbound.js";
import type { ApiApp } from "../types.js";

type Fact = {
  tool: string;
  numbers: Record<string, number | string | null>;
  rows: unknown[];
  empty: boolean;
};

// 4 часа — порог вопроса «кто меньше 4 часов». Новое число не вводим.
const SHORT_SHIFT_SECONDS = 14400;

function moscowToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDay(offset: number): string {
  const now = new Date();
  const moscow = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moscow);
}

function routeQuestion(question: string): Fact["tool"] | "unknown" {
  const text = question.toLowerCase();
  if (/внутри|на объекте|кто сейчас/.test(text)) return "who_inside";
  if (/4\s*час|четыр/.test(text)) return "under_four_hours";
  if ((/люд|человек/.test(text) && /зон|где|как/.test(text)) || /больше всего людей/.test(text)) {
    return "busiest_people";
  }
  if (/зон|посещ/.test(text)) return "busiest_zone";
  if (/отказ/.test(text)) return "denials";
  if (/сводк|итог/.test(text)) return "summary";
  return "unknown";
}

function periodFrom(question: string): { from: string; to: string } {
  const text = question.toLowerCase();
  const today = moscowToday();
  if (/недел/.test(text)) return { from: shiftDay(-6), to: today };
  if (/вчера/.test(text)) {
    const yesterday = shiftDay(-1);
    return { from: yesterday, to: yesterday };
  }
  return { from: today, to: today };
}

async function whoInside(pool: pg.Pool): Promise<Fact> {
  const { rows } = await pool.query<{ full_name: string; started_at: Date }>(
    `SELECT p.full_name, s.started_at
     FROM shifts s JOIN people p ON p.id = s.person_id
     WHERE s.ended_at IS NULL
     ORDER BY s.started_at`,
  );
  return {
    tool: "who_inside",
    numbers: { count: rows.length },
    rows: rows.map((row) => ({ full_name: row.full_name, started_at: row.started_at.toISOString() })),
    empty: false,
  };
}

async function underFour(pool: pg.Pool, day: string): Promise<Fact> {
  const { rows } = await pool.query<{ full_name: string; seconds: number }>(
    `SELECT p.full_name,
            SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))::int AS seconds
     FROM shifts s
     JOIN people p ON p.id = s.person_id
     WHERE (s.started_at AT TIME ZONE 'Europe/Moscow')::date = $1::date
     GROUP BY p.id, p.full_name
     HAVING SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at))) > 0
        AND SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at))) < $2`,
    [day, SHORT_SHIFT_SECONDS],
  );
  return {
    tool: "under_four_hours",
    numbers: { day, limit_hours: 4, count: rows.length },
    rows: rows.map((row) => ({ full_name: row.full_name, seconds: row.seconds })),
    empty: rows.length === 0,
  };
}

async function busiestVisits(pool: pg.Pool, day: string): Promise<Fact> {
  const { rows } = await pool.query<{ name: string; visits: number }>(
    `SELECT z.name, COUNT(v.id)::int AS visits
     FROM zones z
     LEFT JOIN visits v ON v.zone_id = z.id
       AND (v.started_at AT TIME ZONE 'Europe/Moscow')::date = $1::date
     GROUP BY z.id, z.name
     ORDER BY visits DESC, z.name`,
    [day],
  );
  const top = rows[0]?.visits ?? 0;
  const leaders = rows.filter((row) => row.visits === top && top > 0);
  return {
    tool: "busiest_zone",
    numbers: { day, visits: top, metric: "посещение" },
    rows: leaders.map((row) => ({ zone_name: row.name, visits: row.visits })),
    empty: top === 0,
  };
}

async function busiestPeople(pool: pg.Pool, day: string): Promise<Fact> {
  const { rows } = await pool.query<{ name: string; people: number }>(
    `SELECT z.name, COUNT(DISTINCT s.person_id)::int AS people
     FROM zones z
     LEFT JOIN visits v ON v.zone_id = z.id
       AND (v.started_at AT TIME ZONE 'Europe/Moscow')::date = $1::date
     LEFT JOIN shifts s ON s.id = v.shift_id
     GROUP BY z.id, z.name
     ORDER BY people DESC, z.name`,
    [day],
  );
  const top = rows[0]?.people ?? 0;
  const leaders = rows.filter((row) => row.people === top && top > 0);
  return {
    tool: "busiest_people",
    numbers: { day, people: top, metric: "человек" },
    rows: leaders.map((row) => ({ zone_name: row.name, people: row.people })),
    empty: top === 0,
  };
}

async function denials(pool: pg.Pool, from: string, to: string): Promise<Fact> {
  const { rows } = await pool.query<{ reason: string; count: number }>(
    `SELECT reason, COUNT(*)::int AS count
     FROM journal
     WHERE decision = 'deny'
       AND (at AT TIME ZONE 'Europe/Moscow')::date >= $1::date
       AND (at AT TIME ZONE 'Europe/Moscow')::date <= $2::date
     GROUP BY reason
     ORDER BY count DESC, reason`,
    [from, to],
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    tool: "denials",
    numbers: { from, to, count: total },
    rows,
    empty: rows.length === 0,
  };
}

async function summary(pool: pg.Pool, from: string, to: string): Promise<Fact> {
  const { rows } = await pool.query<{
    people: number;
    shifts: number;
    refusals: number;
    deviations: number;
    shifts_without_points: number;
  }>(
    `SELECT
       (SELECT COUNT(DISTINCT person_id)::int FROM shifts
         WHERE (started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date
           AND (started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date) AS people,
       (SELECT COUNT(*)::int FROM shifts
         WHERE (started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date
           AND (started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date) AS shifts,
       (SELECT COUNT(*)::int FROM journal
         WHERE decision = 'deny'
           AND (at AT TIME ZONE 'Europe/Moscow')::date >= $1::date
           AND (at AT TIME ZONE 'Europe/Moscow')::date <= $2::date) AS refusals,
       (SELECT COUNT(*)::int FROM shifts s
         WHERE (s.started_at AT TIME ZONE 'Europe/Moscow')::date >= $1::date
           AND (s.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date
           AND EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) > 0
           AND EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) < $3) AS deviations,
       (SELECT COUNT(*)::int FROM shifts s
         WHERE s.ended_at IS NULL
           AND (s.started_at AT TIME ZONE 'Europe/Moscow')::date <= $2::date
           AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.shift_id = s.id)) AS shifts_without_points`,
    [from, to, SHORT_SHIFT_SECONDS],
  );
  const row = rows[0] ?? { people: 0, shifts: 0, refusals: 0, deviations: 0, shifts_without_points: 0 };
  const anomalies = row.refusals + row.shifts_without_points;
  const numbers = {
    from,
    to,
    people: row.people,
    shifts: row.shifts,
    deviations: row.deviations,
    refusals: row.refusals,
    anomalies,
    shifts_without_points: row.shifts_without_points,
  };
  const empty = row.people + row.shifts + row.refusals + row.deviations + anomalies === 0;
  return {
    tool: "summary",
    numbers,
    rows: [numbers],
    empty,
  };
}

function zoneList(fact: Fact): string {
  return fact.rows
    .map((row) => (row && typeof row === "object" && "zone_name" in row ? String((row as { zone_name: unknown }).zone_name) : ""))
    .filter(Boolean)
    .join("», «");
}

function canonical(fact: Fact): string {
  if (fact.empty) return "Данных нет.";
  if (fact.tool === "who_inside") {
    const count = Number(fact.numbers.count ?? 0);
    if (count === 0) return "Сейчас на объекте никого нет.";
    const names = fact.rows
      .map((row) => (row && typeof row === "object" && "full_name" in row ? String((row as { full_name: unknown }).full_name) : ""))
      .filter(Boolean);
    return `На объекте: ${names.join(", ")}.`;
  }
  if (fact.tool === "busiest_people") {
    return `В зоне «${zoneList(fact)}» больше всего людей: ${fact.numbers.people} человек.`;
  }
  if (fact.tool === "busiest_zone") {
    return `Больше всего посещений в зоне «${zoneList(fact)}»: ${fact.numbers.visits}.`;
  }
  if (fact.tool === "summary") {
    return `Людей ${fact.numbers.people}, смен ${fact.numbers.shifts}, отклонений ${fact.numbers.deviations}, отказов ${fact.numbers.refusals}, аномалий ${fact.numbers.anomalies}.`;
  }
  if (fact.tool === "under_four_hours") {
    const names = fact.rows
      .map((row) => (row && typeof row === "object" && "full_name" in row ? String((row as { full_name: unknown }).full_name) : ""))
      .filter(Boolean);
    return `Меньше 4 часов: ${names.join(", ")}. Всего ${fact.numbers.count}.`;
  }
  if (fact.tool === "denials") {
    return `Отказов ${fact.numbers.count}.`;
  }
  return "Формулировка модели недоступна. Цифры ниже из базы.";
}

export function substituteByField(
  text: string,
  numbers: Record<string, number | string | null>,
): { text: string; used: string[] } {
  const used: string[] = [];
  const rendered = text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(numbers, name)) return full;
    const value = numbers[name];
    if (value === null || value === undefined) return full;
    used.push(name);
    return String(value);
  });
  return { text: rendered, used };
}

function strayNumber(text: string, numbers: Record<string, number | string | null>, used: string[]): boolean {
  const allowed = new Set<string>();
  for (const name of used) {
    const value = numbers[name];
    if (typeof value === "number" || typeof value === "string") {
      for (const match of String(value).matchAll(/\d+(?:[.,]\d+)?/g)) {
        allowed.add(match[0]);
        allowed.add(match[0].replace(",", "."));
      }
    }
  }
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return found.some((token) => !allowed.has(token) && !allowed.has(token.replace(",", ".")));
}

export function renderModelText(
  modelText: string,
  numbers: Record<string, number | string | null>,
  canonicalText: string,
  tool: string,
): { text: string; usedModel: boolean } {
  const { text, used } = substituteByField(modelText, numbers);
  const numericNames = Object.entries(numbers)
    .filter(([, value]) => typeof value === "number")
    .map(([name]) => name);
  if (numericNames.length > 0 && !numericNames.some((name) => used.includes(name))) {
    return { text: canonicalText, usedModel: false };
  }
  if (strayNumber(text, numbers, used)) return { text: canonicalText, usedModel: false };
  if (tool === "busiest_people" && (!text.includes("человек") || text.includes("посещен"))) {
    return { text: canonicalText, usedModel: false };
  }
  if (tool === "summary") {
    const required = ["people", "shifts", "deviations", "refusals", "anomalies"];
    if (required.some((name) => !used.includes(name)) || !text.includes("отклонен") || !text.includes("аномал")) {
      return { text: canonicalText, usedModel: false };
    }
  }
  return { text, usedModel: true };
}

function modelPayload(fact: Fact) {
  return {
    tool: fact.tool,
    fields: Object.keys(fact.numbers),
    rows: fact.rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (typeof value === "number") continue;
        if (typeof value === "string" && /\d/.test(value)) continue;
        copy[key] = value;
      }
      return copy;
    }),
  };
}

async function answer(fact: Fact, question: string) {
  const providerName = (process.env.MODEL_PROVIDER ?? "ollama").trim().toLowerCase() || "ollama";
  const canonicalText = canonical(fact);
  if (fact.empty) {
    return { text: "Данных нет.", provider: providerName, model_status: "ok" as const, retry: false };
  }
  try {
    const prompt = await formulatePrompt();
    const spoken = await completeText([
      { role: "system", content: prompt },
      {
        role: "user",
        content: `Вопрос: ${question}\nПоля для подстановки: ${Object.keys(fact.numbers).join(", ")}. Факты без чисел: ${JSON.stringify(modelPayload(fact))}`,
      },
    ]);
    const rendered = renderModelText(spoken.text, fact.numbers, canonicalText, fact.tool);
    if (!rendered.usedModel) {
      return {
        text: canonicalText,
        provider: spoken.id,
        model_status: "rejected_ungrounded" as const,
        retry: true,
      };
    }
    return { text: rendered.text, provider: spoken.id, model_status: "ok" as const, retry: false };
  } catch {
    return {
      text: canonicalText,
      provider: providerName,
      model_status: "unavailable" as const,
      retry: true,
    };
  }
}

export function registerAssistant(app: ApiApp, pool: pg.Pool): void {
  app.post("/assistant/ask", requireRoles("manager"), async (c) => {
    const body = await readJson(c);
    if (!body) return denyJson(c, 400, "Некорректный запрос.");
    const question = asString(body.question);
    if (!question) return denyJson(c, 400, "Напишите вопрос.");
    const tool = routeQuestion(question);
    if (tool === "unknown") {
      return c.json({
        text: "Не понял вопрос. Спросите, кто внутри, кто меньше 4 часов, в какой зоне больше всего людей, какие отказы или сводку.",
        facts: { tool: "unknown", numbers: {}, rows: [] },
        provider: process.env.MODEL_PROVIDER ?? "ollama",
        model_status: "ok",
        retry: false,
      });
    }
    const period = periodFrom(question);
    const fact =
      tool === "who_inside"
        ? await whoInside(pool)
        : tool === "under_four_hours"
          ? await underFour(pool, period.from)
          : tool === "busiest_people"
            ? await busiestPeople(pool, period.from)
            : tool === "busiest_zone"
              ? await busiestVisits(pool, period.from)
              : tool === "denials"
                ? await denials(pool, period.from, period.to)
                : await summary(pool, period.from, period.to);
    const spoken = await answer(fact, question);
    await writeJournal(pool, {
      actorSub: c.get("user").sub,
      what: "вопрос помощнику",
      reason: fact.tool,
      factors: { question, model_status: spoken.model_status, numbers: fact.numbers },
    });
    return c.json({
      text: spoken.text,
      facts: { tool: fact.tool, numbers: fact.numbers, rows: fact.rows },
      provider: spoken.provider,
      model_status: spoken.model_status,
      retry: spoken.retry,
    });
  });

  app.post("/assistant/summary", requireRoles("manager"), async (c) => {
    const body = (await readJson(c)) ?? {};
    const from = asString(body.from) ?? moscowToday();
    const to = asString(body.to) ?? from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return denyJson(c, 400, "Некорректная дата.");
    }
    const fact = await summary(pool, from, to);
    const spoken = await answer(fact, "Сводка за период");
    await writeJournal(pool, {
      actorSub: c.get("user").sub,
      what: "сводка помощника",
      reason: "summary",
      factors: { from, to, model_status: spoken.model_status, numbers: fact.numbers },
    });
    return c.json({
      text: spoken.text,
      facts: { tool: fact.tool, numbers: fact.numbers, rows: fact.rows },
      provider: spoken.provider,
      model_status: spoken.model_status,
      retry: spoken.retry,
    });
  });
}
