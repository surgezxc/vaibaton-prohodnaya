import type { ChatMsg, ModelProvider } from "./types.js";

type Statement = { id: string; variants: [string, string] };
type Fact = { tool: string; numbers: Record<string, unknown>; rows: Record<string, unknown>[]; empty: boolean };

export function answerSchema(messages: ChatMsg[]): object | undefined {
  if (!messages.some((message) => message.role === "system" && message.content.includes("sentences"))) return undefined;
  const user = [...messages].reverse().find((message) => message.role === "user");
  const ids = (JSON.parse(user?.content ?? "{}").statements as Statement[]).map((statement) => statement.id);
  return { type: "object", additionalProperties: false, required: ["sentences"], properties: {
    sentences: { type: "array", minItems: ids.length, maxItems: ids.length, items: {
      type: "object", additionalProperties: false, required: ["id", "variant"], properties: {
        id: { type: "string", enum: ids }, variant: { type: "integer", enum: [0, 1] },
      },
    } },
  } };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Некорректный агрегат SQL.");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error("Некорректный факт SQL.");
  return value;
}

export function statementsFor(value: unknown): Statement[] {
  if (!record(value) || !record(value.numbers) || !Array.isArray(value.rows)
      || !value.rows.every(record) || typeof value.empty !== "boolean" || typeof value.tool !== "string") {
    throw new Error("Некорректный ответ tool.");
  }
  const fact = value as Fact;
  if (!["who_inside", "under_four_hours", "busiest_zone", "denials", "summary"].includes(fact.tool)) {
    throw new Error("Неизвестный tool.");
  }
  if (fact.empty || fact.rows.length === 0) return [];
  const result: Statement[] = [];
  const add = (id: string, short: string, full: string) => result.push({ id, variants: [short, full] });
  const n = fact.numbers;
  switch (fact.tool) {
    case "who_inside":
      add("numbers.count", `Сейчас на объекте: ${number(n.count)} человек.`, `По данным открытых смен на объекте сейчас ${number(n.count)} человек.`);
      fact.rows.forEach((row, i) => add(`rows.${i}`, `${string(row.full_name)} — внутри с ${string(row.started_at)}.`,
        `Открытая смена: ${string(row.full_name)}, начало — ${string(row.started_at)}.`));
      break;
    case "under_four_hours":
      add("numbers.count", `За ${string(n.day)} меньше ${number(n.limit_hours)} часов: ${number(n.count)} человек.`,
        `По данным смен за ${string(n.day)} у ${number(n.count)} человек время работы меньше ${number(n.limit_hours)} часов.`);
      fact.rows.forEach((row, i) => add(`rows.${i}`, `${string(row.full_name)} — ${number(row.seconds)} секунд.`,
        `Время работы ${string(row.full_name)}: ${number(row.seconds)} секунд.`));
      break;
    case "busiest_zone":
      add("numbers.day", `Дата посещений: ${string(n.day)}.`, `Сравнение посещений выполнено за ${string(n.day)}.`);
      fact.rows.forEach((row, i) => add(`rows.${i}`, `Лидер по посещениям: ${string(row.zone_name)} — ${number(row.visits)}.`,
        `Максимум посещений у зоны «${string(row.zone_name)}»: ${number(row.visits)}.`));
      break;
    case "denials":
      add("numbers.count", `С ${string(n.from)} по ${string(n.to)} отказов: ${number(n.count)}.`,
        `За период ${string(n.from)} — ${string(n.to)} зарегистрировано отказов: ${number(n.count)}.`);
      fact.rows.forEach((row, i) => add(`rows.${i}`, `${string(row.reason)} — ${number(row.count)} отказов.`,
        `Причина «${string(row.reason)}»: отказов ${number(row.count)}.`));
      break;
    case "summary":
      add("numbers.period", `Период: ${string(n.from)} — ${string(n.to)}.`, `Сводка за период с ${string(n.from)} по ${string(n.to)}.`);
      for (const [key, label] of [["people", "Людей"], ["shifts", "Смен"], ["denials", "Отказов"]]) {
        add(`numbers.${key}`, `${label}: ${number(n[key])}.`, `${label} за выбранный период: ${number(n[key])}.`);
      }
      break;
  }
  return result;
}

export function renderAnswer(raw: string, statements: Statement[]): string {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.sentences)
      || value.sentences.length !== statements.length) throw new Error("Неверный формат ответа модели.");
  const remaining = new Map(statements.map((item) => [item.id, item]));
  const text = value.sentences.map((entry: unknown) => {
    if (!record(entry) || Object.keys(entry).length !== 2 || typeof entry.id !== "string"
        || (entry.variant !== 0 && entry.variant !== 1)) throw new Error("Неверная ссылка на факт.");
    const statement = remaining.get(entry.id);
    if (!statement) throw new Error("Неизвестный или повторный факт.");
    remaining.delete(entry.id);
    return statement.variants[entry.variant];
  });
  return text.join(" ");
}

export async function groundedComplete(provider: ModelProvider, messages: ChatMsg[]): Promise<string> {
  const last = messages.at(-1)?.content ?? "";
  const marker = last.lastIndexOf("\nФакты: ");
  if (marker < 0) return provider.complete(messages);
  const facts: unknown = JSON.parse(last.slice(marker + "\nФакты: ".length));
  const statements = statementsFor(facts);
  if (statements.length === 0) return "Данных нет.";
  const request: ChatMsg[] = [
    ...messages.slice(0, -1),
    { role: "user", content: JSON.stringify({ question: last.slice(0, marker), statements }) },
  ];
  const raw = await provider.complete(request);
  try {
    return renderAnswer(raw, statements);
  } catch {
    // Retry malformed output once; transport failures propagate to API's status/retry handling.
    const corrected = await provider.complete([...request,
      { role: "system", content: "Исправь формат: только JSON sentences, каждый id ровно один раз, variant 0 или 1." },
    ]);
    return renderAnswer(corrected, statements);
  }
}
