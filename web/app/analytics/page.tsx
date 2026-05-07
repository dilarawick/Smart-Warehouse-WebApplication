export const metadata = {
  title: "Analytics – Smart Warehouse",
  description: "Warehouse analytics and metrics",
};

import { headers } from "next/headers";
import { TimeCell } from "./TimeCell";
import { ServoControls } from "./ServoControls";

type BeltEventRow = {
  Id: number;
  DeviceId: string;
  EventType: string;
  GateState: string;
  BeltState: string;
  QrText: string | null;
  Note: string | null;
  CreatedAtUtc: string;
};

type BeltTelemetry = {
  deviceId: string;
  updatedAt: string;
  lcdLine1: string;
  lcdLine2: string;
  temperatureC: number | null;
  humidityPct: number | null;
};

async function getBeltEvents(): Promise<{ items: BeltEventRow[] }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = host ? `${proto}://${host}` : "http://localhost:3000";

  const res = await fetch(`${base}/api/belt/events?limit=50`, { cache: "no-store" });
  if (!res.ok) return { items: [] };
  return res.json();
}

async function getBeltTelemetry(): Promise<{ item: BeltTelemetry | null }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = host ? `${proto}://${host}` : "http://localhost:3000";

  const res = await fetch(`${base}/api/belt/telemetry`, { cache: "no-store" });
  if (!res.ok) return { item: null };
  return res.json();
}

function pill(text: string, bg: string) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        border: "1px solid rgba(255,255,255,0.06)",
        fontSize: 12,
        fontWeight: 600,
        color: "#e6eef9",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export default async function AnalyticsPage() {
  const data = await getBeltEvents();
  const latest = data.items[0] ?? null;
  const telemetry = (await getBeltTelemetry()).item;

  return (
    <main style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Analytics</h1>
      <p style={{ margin: "0 0 24px", color: "#52525b", lineHeight: 1.5 }}>
        Live belt + gate status events (from SQL). This helps verify that S2 QR decisions are actually being applied.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <code style={{ padding: "8px 10px", background: "#0b3355", borderRadius: 8, color: "#e6eef9" }}>
        </code>
        <code style={{ padding: "8px 10px", background: "#0b3355", borderRadius: 8, color: "#e6eef9" }}>
        </code>
      </div>

      <section
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 16,
          background: "#0f2b4d",
          marginBottom: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Live telemetry (LCD + DHT22)</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#71717a" }}>
          Latest payload posted<code>.</code>
        </p>

        {!telemetry ? (
          <div style={{ marginTop: 12, color: "#71717a" }}>
            No telemetry yet. Once the ESP32 posts temperature/humidity + LCD lines, it’ll appear here.
          </div>
        ) : (
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, background: "#0b3355" }}>
              <div style={{ fontSize: 12, color: "#52525b", fontWeight: 700, marginBottom: 8 }}>LCD (16x2)</div>
                  <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "#0f2b4d",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#e6eef9",
                }}
              >
                {(telemetry.lcdLine1 ?? "").padEnd(16).slice(0, 16)}
                {"\n"}
                {(telemetry.lcdLine2 ?? "").padEnd(16).slice(0, 16)}
              </pre>
            </div>

            <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, background: "#0b3355" }}>
              <div style={{ fontSize: 12, color: "#52525b", fontWeight: 700, marginBottom: 8 }}>
                DHT22 + device
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {pill(`Temp: ${telemetry.temperatureC == null ? "—" : `${telemetry.temperatureC.toFixed(1)}°C`}`, "#0b3355")}
                {pill(`RH: ${telemetry.humidityPct == null ? "—" : `${Math.round(telemetry.humidityPct)}%`}`, "#0b3355")}
                {pill(`Device: ${telemetry.deviceId}`, "#0b3355")}
                <span style={{ fontSize: 12, color: "#a9c8ee" }}>{telemetry.updatedAt}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      <ServoControls />

      <section
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 16,
          background: "#0f2b4d",
          marginBottom: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Latest state</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#71717a" }}>
          Most recent row in <code>dbo.BeltEvents</code>.
        </p>

        {!latest ? (
          <div style={{ marginTop: 12, color: "#71717a" }}>
            No belt events yet. Once the belt ESP32 boots and posts, you’ll see rows here.
          </div>
        ) : (
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {pill(`Gate: ${latest.GateState}`, latest.GateState === "open" ? "#063b2e" : "#551313")}
            {pill(`Belt: ${latest.BeltState}`, latest.BeltState === "running" ? "#0a2b4c" : "#0b3355")}
            {pill(`Event: ${latest.EventType}`, "#0b3355")}
            {pill(`Device: ${latest.DeviceId}`, "#0b3355")}
            <span style={{ fontSize: 12, color: "#a9c8ee" }}>
              <TimeCell iso={latest.CreatedAtUtc} />
            </span>
          </div>
        )}
      </section>

      <section
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          overflow: "hidden",
          background: "#0f2b4d",
        }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Belt events (history)</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#a9c8ee" }}>
            Latest 50 rows, newest first.
          </p>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#0b3355" }}>
                {["Time (local)", "Device", "Event", "Gate", "Belt", "Note", "QR text"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      color: "#cfe8ff",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 14, color: "#71717a" }}>
                    No rows yet.
                  </td>
                </tr>
              ) : (
                data.items.map((r) => (
                  <tr key={r.Id}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", whiteSpace: "nowrap" }}>
                      <TimeCell iso={r.CreatedAtUtc} />
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.DeviceId}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.EventType}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.GateState}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.BeltState}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span style={{ color: "#cfe8ff" }}>{r.Note ?? ""}</span>
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", maxWidth: 420 }}>
                      <span style={{ color: "#cfe8ff" }}>{r.QrText ?? ""}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
