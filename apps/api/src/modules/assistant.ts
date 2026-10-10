import type pg from "pg";
import { requireRoles } from "../auth.js";
import { asString, denyJson, readJson } from "../http.js";
import { writeJournal } from "../journal.js";
import { formulatePrompt, getModel, modelAddedNumber } from "../model/index.js";
import type { ApiApp } from "../types.js";

type Fact = {
  tool: string;
  numbers: Record<string, number | string | null>;
  rows: unknown[];
  empty: boolean;
};

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
  if (/зон|людн|посещ/.test(text)) return "busiest_zone";
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
        AND SUM(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at))) < 14400`,
    [day],
  );
  return {
    tool: "under_four_hours",
    numbers: { day, limit_hours: 4, count: rows.length },
    rows: rows.map((row) => ({ full_name: row.full_name, seconds: row.seconds })),
    empty: rows.length === 0,
  };
}

async function busiest(pool: pg.Pool, day: string): Promise<Fact> {
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
    numbers: { day, visits: top },
    rows: leaders.map((row) => ({ zone_name: row.name, visits: row.visits })),
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
  const { rows } = await pool.query<{ people: number; shifts: number; denials: number }>(
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
           AND (at AT TIME ZONE 'Europe/Moscow')::date <= $2::date) AS denials`,
    [from, to],
  );
  const row = rows[0] ?? { people: 0, shifts: 0, denials: 0 };
  return {
    tool: "summary",
    numbers: { from, to, people: row.people, shifts: row.shifts, denials: row.denials },
    rows: [row],
    empty: false,
  };
}

function fallbackText(fact: Fact): string {
  if (fact.empty) return "Данных нет.";
  if (fact.tool === "who_inside") {
    const count = Number(fact.numbers.count ?? 0);
    if (count === 0) return "Сейчас на объекте никого нет.";
    const names = fact.rows
      .map((row) => (row && typeof row === "object" && "full_name" in row ? String((row as { full_name: unknown }).full_name) : ""))
      .filter(Boolean);
    return `На объекте: ${names.join(", ")}. Формулировка модели недоступна, цифры из базы.`;
  }
  if (fact.tool === "summary") {
    return `Людей ${fact.numbers.people}, смен ${fact.numbers.shifts}, отказов ${fact.numbers.denials}. Формулировка модели недоступна, цифры из базы.`;
  }
  return "Формулировка модели недоступна. Цифры ниже из базы.";
}

async function answer(pool: pg.Pool, fact: Fact, question: string) {
  const providerName = (process.env.MODEL_PROVIDER ?? "ollama").trim().toLowerCase() || "ollama";
  if (fact.empty) {
    return { text: "Данных нет.", provider: providerName, model_status: "ok" as const, retry: false };
  }
  try {
    const model = getModel();
    const prompt = await formulatePrompt();
    const text = await model.complete([
      { role: "system", content: prompt },
      { role: "user", content: `Вопрос: ${question}\nФакты: ${JSON.stringify(fact)}` },
    ]);
    if (modelAddedNumber(text, fact)) {
      return {
        text: "Модель добавила число, которого нет в данных. Показываю только факты из базы.",
        provider: model.id,
        model_status: "rejected_ungrounded" as const,
        retry: true,
      };
    }
    return { text, provider: model.id, model_status: "ok" as const, retry: false };
  } catch {
    return {
      text: fallbackText(fact),
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
        text: "Не понял вопрос. Спросите, кто внутри, кто меньше 4 часов, какая зона люднее, какие отказы или сводку.",
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
          : tool === "busiest_zone"
            ? await busiest(pool, period.from)
            : tool === "denials"
              ? await denials(pool, period.from, period.to)
              : await summary(pool, period.from, period.to);
    const spoken = await answer(pool, fact, question);
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
    const spoken = await answer(pool, fact, "Сводка за период");
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
