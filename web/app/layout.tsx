import type { ReactNode } from "react";

export const metadata = {
  title: "Smart Warehouse – QR Scans",
  description: "Recent QR scans from ESP32‑CAM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
        {children}
      </body>
    </html>
  );
}

