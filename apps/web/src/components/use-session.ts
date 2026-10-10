"use client";

import { useEffect, useState } from "react";
import { loadSession, saveSession, clearSession, type Session } from "@/lib/session";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  function login(next: Session) {
    saveSession(next);
    setSession(next);
  }

  function logout() {
    clearSession();
    setSession(null);
  }

  return { session, login, logout };
}
