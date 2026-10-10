// Explicit fixtures for a provider check; these are never exposed as live SQL facts.
import { formulatePrompt, getModel } from "./index.js";
import { statementsFor } from "./grounded.js";
import { writeFile } from "node:fs/promises";

const facts = {
  tool: "summary", numbers: { from: "2026-10-09", to: "2026-10-10", people: 12, shifts: 14, denials: 0 },
  rows: [{ people: 12, shifts: 14, denials: 0 }], empty: false,
};
const started = performance.now();
let phase = "provider";
try {
  const model = getModel();
  const all = process.argv.includes("--all-tools");
  const fixtures = all ? [facts,
    { tool: "who_inside", numbers: { count: 1 }, rows: [{ full_name: "Тестовый сотрудник", started_at: "2026-10-10T08:00:00Z" }], empty: false },
    { tool: "under_four_hours", numbers: { day: "2026-10-09", limit_hours: 4, count: 1 }, rows: [{ full_name: "Тестовый сотрудник", seconds: 7200 }], empty: false },
    { tool: "busiest_zone", numbers: { day: "2026-10-09" }, rows: [{ zone_name: "Тестовая зона", visits: 7 }], empty: false },
    { tool: "denials", numbers: { from: "2026-10-03", to: "2026-10-10", count: 2 }, rows: [{ reason: "Лицо не совпало", count: 2 }], empty: false },
    { tool: "who_inside", numbers: { count: 0 }, rows: [], empty: true },
  ] : [facts];
  const results = [];
  for (const fixture of fixtures) {
    const callStarted = performance.now();
    const text = await model.complete([
      { role: "system", content: await formulatePrompt() },
      { role: "user", content: `Вопрос: Сформулируй результат\nФакты: ${JSON.stringify(fixture)}` },
    ]);
    const statements = statementsFor(fixture);
    if (statements.length === 0) {
      if (text !== "Данных нет.") throw new Error("Пустые данные подменены ответом.");
    } else {
      for (const statement of statements) {
        if (!statement.variants.some((variant) => text.includes(variant))) throw new Error("Ответ потерял SQL-факт.");
      }
    }
    results.push({ tool: fixture.tool, empty: fixture.empty, status: "ok", text,
      elapsed_ms: Math.round(performance.now() - callStarted) });
  }
  const report = { fixture: true, provider: model.id, status: "ok", results, elapsed_ms: Math.round(performance.now() - started) };
  console.log(JSON.stringify(report, null, 2));
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const output = process.argv[outputIndex + 1];
    if (!output) throw new Error("Укажите путь отчёта после --output.");
    phase = "report";
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
} catch (error) {
  console.error(JSON.stringify({ fixture: true, provider: process.env.MODEL_PROVIDER ?? "ollama",
    status: phase === "provider" ? "unavailable" : "report_write_failed", retry: true,
    phase, error_type: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
}
