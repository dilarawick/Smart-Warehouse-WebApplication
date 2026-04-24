import { headers } from "next/headers";
import { LastCapturePreview } from "./last-capture-preview";

type Scan = {
  Id: number;
  DeviceId: string;
  QrText: string;
  ScannedAtUtc: string;
};

async function getScans(): Promise<{ items: Scan[] }> {
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
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px" }}>QR Scans</h1>
      <p style={{ margin: "0 0 20px", opacity: 0.8 }}>
        Showing the latest scans stored in Azure SQL, plus a live preview of the last image from the camera.
      </p>

      <LastCapturePreview />

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <code style={{ padding: "8px 10px", background: "#f3f4f6", borderRadius: 8 }}>
          API: /api/qr/scans
        </code>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 160px 1fr", background: "#f9fafb" }}>
          <div style={{ padding: 12, fontWeight: 600 }}>Time (UTC)</div>
          <div style={{ padding: 12, fontWeight: 600 }}>Device</div>
          <div style={{ padding: 12, fontWeight: 600 }}>QR Text</div>
        </div>
        {data.items.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.7 }}>No scans yet.</div>
        ) : (
          data.items.map((x) => (
            <div
              key={x.Id}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 160px 1fr",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <div style={{ padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {new Date(x.ScannedAtUtc).toISOString().slice(11, 19)}
              </div>
              <div style={{ padding: 12 }}>{x.DeviceId}</div>
              <div style={{ padding: 12, wordBreak: "break-word" }}>{x.QrText}</div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

