import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cuidado em Casa · Desenvolvimento",
  description: "Ambiente local de desenvolvimento do Cuidado em Casa.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
