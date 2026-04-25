"use client";

import { useEffect, useState } from "react";

export type ScanRow = {
  Id: number;
  DeviceId: string;
  QrText: string;
  ScannedAtUtc: string;
};

type Props = {
  initialItems: ScanRow[];
};

function formatLocalTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function QrScansLive({ initialItems }: Props) {
  const [items, setItems] = useState<ScanRow[]>(initialItems);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/qr/scans?limit=50", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { items?: ScanRow[] };
        if (!cancelled) {
          setItems(Array.isArray(j.items) ? j.items : []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load scans");
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      {err ? (
        <div style={{ padding: 12, color: "#b91c1c", borderBottom: "1px solid #fecaca" }}>{err}</div>
      ) : null}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 160px 1fr", background: "#f9fafb" }}>
          <div style={{ padding: 12, fontWeight: 600 }}>Time (local)</div>
          <div style={{ padding: 12, fontWeight: 600 }}>Device</div>
          <div style={{ padding: 12, fontWeight: 600 }}>QR Text</div>
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.7 }}>No scans yet.</div>
        ) : (
          items.map((x) => (
            <div
              key={x.Id}
              style={{
                display: "grid",
                gridTemplateColumns: "160px 160px 1fr",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              <div style={{ padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {formatLocalTime(x.ScannedAtUtc)}
              </div>
              <div style={{ padding: 12 }}>{x.DeviceId}</div>
              <div style={{ padding: 12, wordBreak: "break-word" }}>{x.QrText}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
