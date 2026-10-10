import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Проходная",
  description: "Контроль прохода и смен на строительном объекте",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ru"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
