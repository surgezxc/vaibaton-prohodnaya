import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gigachatProvider } from "./providers/gigachat.js";
import { ollamaProvider } from "./providers/ollama.js";
import type { ModelProvider } from "./types.js";

export type { ChatMsg, ModelProvider } from "./types.js";

const FALLBACK_PROMPT = `Ты формулируешь ответ руководителю стройки по-русски.
Числа не пиши цифрами. Каждое число — только плейсхолдер {имя_поля} из списка fields.
Имя поля не выбирай и не подставляй чужое значение: сервер сам заменит {имя_поля}.
Для вопроса про людей в зоне пиши «человек», не «посещение».
В сводке обязательно слова «отклонений» и «аномалий» и поля people, shifts, deviations, refusals, anomalies.
Если rows пустые — скажи, что данных нет.
Коротко: 2–5 предложений.`;

let promptCache: Promise<string> | null = null;

export function getModel(): ModelProvider {
  const provider = (process.env.MODEL_PROVIDER ?? "ollama").trim().toLowerCase();
  if (provider === "gigachat") return gigachatProvider();
  if (provider === "ollama") return ollamaProvider();
  throw new Error(`Неизвестный MODEL_PROVIDER: ${provider}`);
}

export async function formulatePrompt(): Promise<string> {
  if (!promptCache) {
    promptCache = loadPrompt().catch(() => FALLBACK_PROMPT);
  }
  return promptCache;
}

async function loadPrompt(): Promise<string> {
  const configured = process.env.PROMPTS_PATH?.trim();
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const fallbackPath = path.resolve(apiRoot, "..", "prompts", "assistant-formulate.md");
  try {
    return (await readFile(configured || fallbackPath, "utf8")).trim() || FALLBACK_PROMPT;
  } catch {
    return FALLBACK_PROMPT;
  }
}

export function numbersIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "number" && Number.isFinite(value)) {
    found.add(String(value));
    if (!Number.isInteger(value)) found.add(String(Math.trunc(value)));
  } else if (typeof value === "string") {
    for (const match of value.matchAll(/\d+(?:[.,]\d+)?/g)) {
      found.add(match[0].replace(",", "."));
      found.add(match[0]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) numbersIn(item, found);
  }
  return found;
}

export function modelAddedNumber(text: string, facts: unknown): boolean {
  const allowed = numbersIn(facts);
  const used = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return used.some((token) => {
    const normalized = token.replace(",", ".");
    return !allowed.has(token) && !allowed.has(normalized);
  });
}
