import type { ChatMsg, ModelProvider } from "../types.js";
import { answerSchema } from "../grounded.js";

export function ollamaProvider(): ModelProvider {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen3:4b";
  const timeout = Number(process.env.MODEL_TIMEOUT_MS ?? "60000");
  return {
    id: "ollama",
    async complete(messages: ChatMsg[]): Promise<string> {
      const format = answerSchema(messages);
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false, think: false, format, options: { temperature: 0 } }),
        signal: AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? timeout : 60000),
      });
      if (!response.ok) {
        throw new Error(`ollama ${response.status}`);
      }
      const payload = (await response.json()) as { message?: { content?: unknown } };
      const text = typeof payload?.message?.content === "string" ? payload.message.content.trim() : "";
      if (!text) throw new Error("ollama empty");
      return text;
    },
  };
}
