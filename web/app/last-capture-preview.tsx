"use client";

import { useEffect, useState } from "react";

type Payload = {
  image: string | null;
  deviceId: string | null;
  updatedAt: string | null;
  status: "decoded" | "no_qr" | null;
  qrText: string | null;
};

export function LastCapturePreview() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/qr/last-capture", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Payload;
        if (!cancelled) {
          setData(j);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
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
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        background: "#0b3355",
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Latest camera frame</h2>
      <p style={{ margin: "0 0 12px", opacity: 0.9, fontSize: 14, color: "#e6eef9" }}>
        Last JPEG received from the ESP32-CAM.
      </p>
      {err ? <div style={{ color: "#b91c1c" }}>{err}</div> : null}
      {data?.image ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, opacity: 0.9 }}>
            <span>
              <strong>Device:</strong> {data.deviceId ?? "—"}
            </span>
            <span>
              <strong>Status:</strong>{" "}
              {data.status === "decoded" ? "QR decoded" : data.status === "no_qr" ? "No QR in frame" : "—"}
            </span>
            <span>
              <strong>Updated:</strong> {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
            </span>
          </div>
          {data.qrText ? (
            <div style={{ fontSize: 14, wordBreak: "break-word", color: "#e6eef9" }}>
              <strong>QR:</strong> {data.qrText}
            </div>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.image}
            alt="Last capture from ESP32-CAM"
            style={{ maxWidth: "100%", height: "auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}
          />
        </div>
      ) : (
        <div style={{ opacity: 0.85, color: "#e6eef9" }}>No image yet. Point the camera at a scene and wait for the next upload.</div>
      )}
    </section>
  );
}
