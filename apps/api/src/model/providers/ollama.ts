import type { ChatMsg, ModelProvider } from "../types.js";

export function ollamaProvider(): ModelProvider {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen3:4b";
  const timeout = Number(process.env.MODEL_TIMEOUT_MS ?? "8000");
  return {
    id: "ollama",
    async complete(messages: ChatMsg[]): Promise<string> {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? timeout : 8000),
      });
      if (!response.ok) {
        throw new Error(`ollama ${response.status}`);
      }
      const payload = (await response.json()) as { message?: { content?: string } };
      const text = payload.message?.content?.trim() ?? "";
      if (!text) throw new Error("ollama empty");
      return text;
    },
  };
}
