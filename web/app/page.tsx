import { headers } from "next/headers";
import { LastCapturePreview } from "./last-capture-preview";
import { QrScansLive, type ScanRow } from "./qr-scans-live";

async function getScans(): Promise<{ items: ScanRow[] }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = host ? `${proto}://${host}` : "http://localhost:3000";

  const res = await fetch(`${base}/api/qr/scans?limit=50`, { cache: "no-store" });
  if (!res.ok) return { items: [] };
  return res.json();
}

export default async function HomePage() {
  const data = await getScans();

  return (
    <main style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Home · QR scans</h1>
      <p style={{ margin: "0 0 24px", color: "#52525b", lineHeight: 1.5 }}>
        Latest scans in Azure SQL and a live preview of the last frame from the ESP32‑CAM.
      </p>

      <LastCapturePreview />

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <code style={{ padding: "8px 10px", background: "#0b3355", borderRadius: 8, color: "#e6eef9" }}>
          GET /api/qr/scans
        </code>
      </div>

      <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>QR scans (SQL)</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#71717a" }}>
        Refreshes every 1.5s while this page is open (same cadence as the camera preview).
      </p>

      <QrScansLive initialItems={data.items} />
    </main>
  );
}
