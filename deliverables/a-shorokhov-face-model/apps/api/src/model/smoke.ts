// Explicit fixtures for a provider check; these are never exposed as live SQL facts.
import { formulatePrompt, getModel } from "./index.js";

const facts = {
  tool: "summary", numbers: { from: "2026-10-09", to: "2026-10-10", people: 12, shifts: 14, denials: 0 },
  rows: [{ people: 12, shifts: 14, denials: 0 }], empty: false,
};
const started = performance.now();
try {
  const model = getModel();
  const text = await model.complete([
    { role: "system", content: await formulatePrompt() },
    { role: "user", content: `Вопрос: Сводка периода\nФакты: ${JSON.stringify(facts)}` },
  ]);
  console.log(JSON.stringify({ fixture: true, provider: model.id, status: "ok", text, elapsed_ms: Math.round(performance.now() - started) }, null, 2));
} catch {
  console.error(JSON.stringify({ fixture: true, provider: process.env.MODEL_PROVIDER ?? "ollama", status: "unavailable", retry: true }));
  process.exitCode = 1;
}
