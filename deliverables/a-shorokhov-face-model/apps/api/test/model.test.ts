import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { groundedComplete, renderAnswer, statementsFor } from "../src/model/grounded.ts";
import { formulatePrompt, getModel, modelAddedNumber } from "../src/model/index.ts";
import { gigachatProvider } from "../src/model/providers/gigachat.ts";
import { ollamaProvider } from "../src/model/providers/ollama.ts";
import type { ModelProvider } from "../src/model/types.ts";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

const summary = { tool: "summary", numbers: { from: "2026-10-09", to: "2026-10-10", people: 12, shifts: 14, denials: 0 },
  rows: [{ people: 12, shifts: 14, denials: 0 }], empty: false };
const messages = [{ role: "user" as const, content: `Вопрос: Сводка\nФакты: ${JSON.stringify(summary)}` }];
const valid = (facts = summary) => JSON.stringify({ sentences: statementsFor(facts).map((s) => ({ id: s.id, variant: 0 })) });

test("ответ связан с полями, модель не может поменять 12 людей на 12 отказов", () => {
  const statements = statementsFor(summary);
  const answer = renderAnswer(valid(), statements);
  assert.match(answer, /Людей: 12/);
  assert.match(answer, /Отказов: 0/);
  for (const raw of ["Отказов: 12", '{"sentences":[],"text":"Отказов: 12"}',
    JSON.stringify({ sentences: statements.map((s) => ({ id: s.id, variant: 0, value: 12 })) }),
    JSON.stringify({ sentences: statements.map(() => ({ id: "numbers.people", variant: 0 })) })]) {
    assert.throws(() => renderAnswer(raw, statements));
  }
});

test("все пять SQL tools и пустые строки", () => {
  const facts = [summary,
    { tool: "who_inside", numbers: { count: 1 }, rows: [{ full_name: "Гаджиев", started_at: "2026-10-10T08:00:00Z" }], empty: false },
    { tool: "under_four_hours", numbers: { day: "2026-10-09", limit_hours: 4, count: 1 }, rows: [{ full_name: "Гаджиев", seconds: 7200 }], empty: false },
    { tool: "busiest_zone", numbers: { day: "2026-10-09", visits: 5 }, rows: [{ zone_name: "Котлован", visits: 5 }], empty: false },
    { tool: "denials", numbers: { from: "2026-10-03", to: "2026-10-09", count: 2 }, rows: [{ reason: "Чужое лицо", count: 2 }], empty: false },
  ];
  for (const fact of facts) {
    const statements = statementsFor(fact);
    assert.ok(statements.length > 0);
    const raw = JSON.stringify({ sentences: statements.map((s) => ({ id: s.id, variant: 1 })).reverse() });
    assert.equal(modelAddedNumber(renderAnswer(raw, statements), fact), false);
    assert.deepEqual(statementsFor({ ...fact, rows: [] }), []);
  }
  assert.throws(() => statementsFor({ ...summary, tool: "execute_sql" }));
  assert.throws(() => statementsFor({ ...summary, numbers: { ...summary.numbers, people: NaN } }));
});

test("нет строк — без вызова модели; плохой формат — один повтор", async () => {
  let calls = 0;
  const provider: ModelProvider = { id: "test", complete: async () => ++calls === 1 ? "Неверный ответ" : valid() };
  assert.equal(await groundedComplete(provider, [{ role: "user", content: `Вопрос: Кто внутри\nФакты: ${JSON.stringify({ ...summary, rows: [] })}` }]), "Данных нет.");
  assert.equal(calls, 0);
  assert.match(await groundedComplete(provider, messages), /Отказов: 0/);
  assert.equal(calls, 2);
  await assert.rejects(groundedComplete({ id: "test", complete: async () => "{}" }, messages));
});

test("ошибка провайдера не заменяется мок-ответом или другим провайдером", async () => {
  let calls = 0;
  await assert.rejects(groundedComplete({ id: "test", complete: async () => { calls++; throw new Error("timeout"); } }, messages));
  assert.equal(calls, 1);
});

test("реальный зависший HTTP-запрос обоих адаптеров прерывается по таймауту", async () => {
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.MODEL_TIMEOUT_MS = "30";
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.GIGACHAT_AUTH_URL = process.env.OLLAMA_BASE_URL;
  process.env.GIGACHAT_API_KEY = "test-credential";
  try {
    for (const provider of [ollamaProvider(), gigachatProvider()]) {
      const started = performance.now();
      await assert.rejects(provider.complete([]), { name: "TimeoutError" });
      assert.ok(performance.now() - started < 2000);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("промпт из файла, provider из env, лишние числа и дроби", async () => {
  assert.match(await formulatePrompt(), /sentences/);
  process.env.MODEL_PROVIDER = "gigachat";
  assert.equal(getModel().id, "gigachat");
  process.env.MODEL_PROVIDER = "ollama";
  assert.equal(getModel().id, "ollama");
  process.env.MODEL_PROVIDER = "mock";
  assert.throws(getModel);
  assert.equal(modelAddedNumber("7 человек", { count: 0 }), true);
  assert.equal(modelAddedNumber("1 час", { hours: 1.9 }), true);
});

test("Ollama отправляет реальный контракт /api/chat и проверяет content", async () => {
  process.env.OLLAMA_BASE_URL = "http://localhost:11434/";
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "http://localhost:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen3:4b");
    assert.equal(body.think, false);
    assert.equal(body.stream, false);
    assert.ok(init?.signal);
    return Response.json({ message: { content: "ответ" } });
  };
  assert.equal(await ollamaProvider().complete([]), "ответ");
  for (const payload of [null, {}, { message: { content: 12 } }, { message: { content: " " } }]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(ollamaProvider().complete([]));
  }
  globalThis.fetch = async () => new Response("down", { status: 503 });
  await assert.rejects(ollamaProvider().complete([]));
});

test("GigaChat OAuth, актуальный URL, Basic/Bearer, неверный ключ и ответ", async () => {
  process.env.GIGACHAT_API_KEY = "test-credential";
  delete process.env.GIGACHAT_BASE_URL;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (++calls === 1) {
      assert.match(String(input), /\/api\/v2\/oauth$/);
      assert.equal(headers.get("authorization"), "Basic test-credential");
      assert.ok(headers.get("rquid"));
      assert.match(String(init?.body), /GIGACHAT_API_PERS/);
      return Response.json({ access_token: "test-access" });
    }
    assert.equal(input, "https://api.giga.chat/v1/chat/completions");
    assert.equal(headers.get("authorization"), "Bearer test-access");
    return Response.json({ choices: [{ message: { content: "ответ" } }] });
  };
  assert.equal(await gigachatProvider().complete([]), "ответ");
  assert.equal(calls, 2);
  delete process.env.GIGACHAT_API_KEY;
  await assert.rejects(gigachatProvider().complete([]));
  process.env.GIGACHAT_API_KEY = "invalid";
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  await assert.rejects(gigachatProvider().complete([]));
  globalThis.fetch = async () => Response.json({ access_token: 12 });
  await assert.rejects(gigachatProvider().complete([]));
});

test("getModel использует ответ настоящего адаптера в формулировке", async () => {
  process.env.MODEL_PROVIDER = "ollama";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(JSON.parse(body.messages.at(-1).content).statements);
    return Response.json({ message: { content: valid() } });
  };
  const prompt = await formulatePrompt();
  assert.match(await getModel().complete([{ role: "system", content: prompt }, ...messages]), /Отказов: 0/);
});
