"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest, errorMessage, type Decision } from "@/lib/pass-api";

export type AttemptStatus = {
  attempt_id: string; direction: "in" | "out"; expires_at: string;
  status: "pending" | "scanned" | "cancelled" | "decided" | "expired";
  decision: "allow" | "deny" | null; reason_human: string | null;
};

export function useAttemptStatus(id: string | null, subject: string | null, token: () => Promise<string>) {
  const tokenRef = useRef(token); tokenRef.current = token;
  const [state, setState] = useState<{ id: string | null; confirmed: boolean; fresh: boolean; decision: Decision | null; error: string | null }>({ id: null, confirmed: false, fresh: false, decision: null, error: null });
  useEffect(() => {
    setState({ id, confirmed: false, fresh: false, decision: null, error: null });
    if (!id || !subject) return;
    let stopped = false;
    let terminal = false;
    let reading = false;
    let deadline = Date.now() + 160000;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      if (stopped || terminal || reading || document.hidden) return;
      reading = true;
      try {
        const result = await apiRequest<AttemptStatus>(`/attempts/${id}`, await tokenRef.current());
        if (result.attempt_id !== id || !["pending", "scanned", "cancelled", "decided", "expired"].includes(result.status) || !Number.isFinite(Date.parse(result.expires_at))) throw new Error("Некорректный ответ о попытке.");
        deadline = Date.parse(result.expires_at) + 20000;
        terminal = ["decided", "cancelled"].includes(result.status) || (result.status === "expired" && Date.now() > deadline);
        let decision: Decision | null = null;
        if (result.status === "decided") {
          if (result.decision !== "allow" && result.decision !== "deny") throw new Error("Результат проверки неизвестен.");
          decision = { decision: result.decision, reason: result.reason_human || "Попытка завершена сервером." };
        } else if (["cancelled", "expired"].includes(result.status)) decision = { decision: "deny", reason: result.reason_human || "Срок QR истёк. Откройте новый код на планшете." };
        if (!stopped) setState({ id, confirmed: result.status === "scanned", fresh: true, decision, error: null });
      } catch (error) {
        if (!stopped) setState((prev) => ({ ...prev, fresh: false, error: errorMessage(error) }));
      } finally { reading = false; }
      if (!stopped && !terminal && Date.now() <= deadline) timer = setTimeout(read, 2000);
    }
    function visibility() { clearTimeout(timer); if (!document.hidden) void read(); }
    document.addEventListener("visibilitychange", visibility);
    void read();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [id, subject]);
  return state.id === id ? state : { id, confirmed: false, fresh: false, decision: null, error: null };
}
