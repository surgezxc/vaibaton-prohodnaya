"use client";

import Link from "next/link";
import { LoginCard } from "@/components/login-card";
import { RoleWarning, Shell } from "@/components/shell";
import { useSession } from "@/components/use-session";
import { ZoneEditor } from "@/components/zone-editor";

export default function ZonesPage() {
  const { session, login, logout } = useSession();
  return (
    <Shell current="/admin" session={session} onLogout={logout}>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Кадры</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">План и зоны</h1>
      <p className="mt-2 mb-5 max-w-2xl text-stone-600">
        Привяжите схему площадки к GPS тремя точками, затем обведите зоны. По этим границам сервер считает посещения.{" "}
        <Link href="/admin" className="font-semibold text-emerald-900">
          К списку людей
        </Link>
      </p>
      {session ? (
        <>
          <div className="mb-4">
            <RoleWarning session={session} role="admin" label="администратор" />
          </div>
          <ZoneEditor token={session.token} />
        </>
      ) : (
        <LoginCard username="admin" onSuccess={login} />
      )}
    </Shell>
  );
}
