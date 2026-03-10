import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "../components/header";
import { QueryProvider } from "../lib/query-provider";

export const metadata: Metadata = {
  title: "Bags Holder Rewards",
  description: "Premium dashboard for Bags fee-share holder rewards"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <Header />
          <main className="app-container app-main">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
