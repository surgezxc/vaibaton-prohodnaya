"use client";

import { FormEvent, useState } from "react";
import { Panel } from "@/components/shell";
import { apiRequest, offlineReason, serverReason } from "@/lib/api";
import type { Period } from "@/components/manager-analytics";

const suggestions = ["Кто сейчас на объекте?", "В какой зоне больше всего людей сегодня?", "Кто вчера работал меньше 4 часов?", "Какие отказы за неделю?"];

type Reply = { text: string; status: string };

const statusNote: Record<string, string> = {
  rejected_ungrounded: "Модель вставила число не из базы — показан текст из фактов.",
  unavailable: "Модель недоступна — показан текст из фактов. Можно повторить.",
};

function readReply(json: Record<string, unknown> | null): Reply {
  return { text: typeof json?.text === "string" ? json.text : "Сервер не вернул текст.", status: String(json?.model_status ?? "ok") };
}

export function ManagerAssistant({ token, period }: { token: string; period: Period }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Reply | null>(null);
  const [summary, setSummary] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"ask" | "summary" | null>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setPending("ask");
    setError(null);
    const response = await apiRequest("/assistant/ask", "POST", token, { question: question.trim() });
    setPending(null);
    if (response.offline) return setError(offlineReason);
    if (response.status !== 200) return setError(serverReason(response.json, "Помощник не ответил."));
    setAnswer(readReply(response.json));
  }

  async function summarize() {
    setPending("summary");
    setError(null);
    const response = await apiRequest("/assistant/summary", "POST", token, period);
    setPending(null);
    if (response.offline) return setError(offlineReason);
    if (response.status !== 200) return setError(serverReason(response.json, "Сводка не готова."));
    setSummary(readReply(response.json));
  }

  return (
    <Panel title="Помощник руководителя">
      <div className="mb-3 flex flex-wrap gap-2">
        {suggestions.map((text) => (
          <button key={text} type="button" className="rounded-full border border-stone-300 px-3 py-1 text-sm" onClick={() => setQuestion(text)}>
            {text}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => void ask(event)} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="assistant-question">Вопрос</label>
        <input
          id="assistant-question"
          className="min-h-11 flex-1 rounded-xl border border-stone-300 px-3"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Например: кто вчера работал меньше 4 часов?"
        />
        <button type="submit" className="min-h-11 rounded-xl bg-emerald-900 px-5 font-semibold text-white" disabled={pending !== null || !question.trim()}>
          {pending === "ask" ? "Считаем…" : "Спросить"}
        </button>
      </form>
      {answer ? <ReplyBox title="Ответ по данным системы" reply={answer} /> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3 text-sm">
        <span>Сводка за {period.from === period.to ? period.from : `${period.from} — ${period.to}`}</span>
        <button type="button" className="min-h-11 rounded-xl border border-stone-300 px-4 font-semibold" onClick={() => void summarize()} disabled={pending !== null}>
          {pending === "summary" ? "Готовим…" : "Подготовить"}
        </button>
      </div>
      {summary ? <ReplyBox title="Сводка" reply={summary} /> : null}
      {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <p className="mt-3 text-xs text-stone-500">Цифры считает база, модель только формулирует. Нет данных — помощник так и скажет.</p>
    </Panel>
  );
}

function ReplyBox({ title, reply }: { title: string; reply: Reply }) {
  return (
    <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3">
      <b className="text-sm">{title}</b>
      <p className="mt-1">{reply.text}</p>
      {statusNote[reply.status] ? <p className="mt-1 text-xs text-amber-800">{statusNote[reply.status]}</p> : null}
    </div>
  );
}
