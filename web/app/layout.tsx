import type { ReactNode } from "react";
import { AppShell } from "./app-shell";

export const metadata = {
  title: "Smart Warehouse",
  description: "Warehouse dashboard · QR scans · IoT",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
          background: "#071a3b",
          color: "#e6eef9",
        }}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

