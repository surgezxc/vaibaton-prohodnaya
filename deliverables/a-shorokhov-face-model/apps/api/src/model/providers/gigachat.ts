import { randomUUID } from "node:crypto";
import type { ChatMsg, ModelProvider } from "../types.js";

export function gigachatProvider(): ModelProvider {
  const authUrl = process.env.GIGACHAT_AUTH_URL ?? "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
  const base = (process.env.GIGACHAT_BASE_URL ?? "https://api.giga.chat/v1").replace(/\/$/, "");
  const apiKey = process.env.GIGACHAT_API_KEY?.trim() ?? "";
  const scope = process.env.GIGACHAT_SCOPE ?? "GIGACHAT_API_PERS";
  const model = process.env.GIGACHAT_MODEL ?? "GigaChat";
  const timeout = Number(process.env.MODEL_TIMEOUT_MS ?? "8000");
  const signalMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 8000;

  return {
    id: "gigachat",
    async complete(messages: ChatMsg[]): Promise<string> {
      if (!apiKey) throw new Error("gigachat key missing");
      const signal = AbortSignal.timeout(signalMs);
      const auth = await fetch(authUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${apiKey}`,
          rquid: randomUUID(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `scope=${encodeURIComponent(scope)}`,
        signal,
      });
      if (!auth.ok) throw new Error(`gigachat auth ${auth.status}`);
      const tokenPayload = (await auth.json()) as { access_token?: unknown };
      if (typeof tokenPayload?.access_token !== "string" || !tokenPayload.access_token.trim()) throw new Error("gigachat token missing");

      const chat = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenPayload.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
        signal,
      });
      if (!chat.ok) throw new Error(`gigachat ${chat.status}`);
      const payload = (await chat.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload?.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      if (!text) throw new Error("gigachat empty");
      return text;
    },
  };
}
