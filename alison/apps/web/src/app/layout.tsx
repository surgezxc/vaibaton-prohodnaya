import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Проходная — контроль площадки",
  description: "Учёт людей, смен и перемещений на строительной площадке",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
