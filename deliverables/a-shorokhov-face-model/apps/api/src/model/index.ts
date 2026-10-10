import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gigachatProvider } from "./providers/gigachat.js";
import { ollamaProvider } from "./providers/ollama.js";
import type { ModelProvider } from "./types.js";
import { groundedComplete } from "./grounded.js";

export type { ChatMsg, ModelProvider } from "./types.js";

export function getModel(): ModelProvider {
  const provider = (process.env.MODEL_PROVIDER ?? "ollama").trim().toLowerCase();
  const raw = provider === "gigachat" ? gigachatProvider() : provider === "ollama" ? ollamaProvider() : null;
  if (!raw) throw new Error(`Неизвестный MODEL_PROVIDER: ${provider}`);
  return { id: raw.id, complete: (messages) => groundedComplete(raw, messages) };
}

export async function formulatePrompt(): Promise<string> {
  return loadPrompt();
}

async function loadPrompt(): Promise<string> {
  const configured = process.env.PROMPTS_PATH?.trim();
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const fallbackPath = path.resolve(apiRoot, "..", "..", "prompts", "assistant-formulate.md");
  const prompt = (await readFile(configured || fallbackPath, "utf8")).trim();
  if (!prompt) throw new Error("Промпт помощника пуст.");
  return prompt;
}

export function numbersIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "number" && Number.isFinite(value)) {
    found.add(String(value));
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
