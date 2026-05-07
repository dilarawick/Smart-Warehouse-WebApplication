"use client";

import { useEffect, useMemo, useState } from "react";

type LastCapture = {
  status: "decoded" | "no_qr" | null;
  qrText: string | null;
  updatedAt: string | null;
  deviceId: string | null;
  image: string | null;
};

async function postServo(label: "A" | "B", angleDeg: number) {
  const res = await fetch("/api/belt/servo-command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, angleDeg, deviceId: "belt-esp32-01" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Failed");
}

export function ServoControls() {
  const [capture, setCapture] = useState<LastCapture | null>(null);
  const [busy, setBusy] = useState<"A" | "B" | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/qr/last-capture", { cache: "no-store" });
        const data = (await res.json()) as LastCapture;
        if (alive) setCapture(data);
      } catch {
        if (alive) setCapture(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const detected = useMemo(() => {
    const t = (capture?.qrText ?? "").toLowerCase();
    if (!t) return null;
    if (t.includes("category a")) return "A";
    if (t.includes("category b")) return "B";
    return null;
  }, [capture?.qrText]);

  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: 16,
        background: "#0f2b4d",
        marginBottom: 14,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Manual servo override (MG90)</h2>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#a9c8ee" }}>
        Force the gate servo angle from the UI. Category A → <code>45°</code>, Category B → <code>0°</code>.
      </p>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={async () => {
            setBusy("A");
            setMsg("");
            try {
              await postServo("A", 45);
              setMsg("Sent: Category A (45°)");
            } catch (e: any) {
              setMsg(`Error: ${String(e?.message ?? e)}`);
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy != null}
            style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: detected === "A" ? "#063b2e" : "#0b3355",
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            color: "#e6eef9",
          }}
        >
          Force A (45°)
        </button>

        <button
          onClick={async () => {
            setBusy("B");
            setMsg("");
            try {
              await postServo("B", 0);
              setMsg("Sent: Category B (0°)");
            } catch (e: any) {
              setMsg(`Error: ${String(e?.message ?? e)}`);
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy != null}
            style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: detected === "B" ? "#5b1a1a" : "#0b3355",
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            color: "#e6eef9",
          }}
        >
          Force B (0°)
        </button>

        <span style={{ fontSize: 13, color: "#a9c8ee" }}>
          Last QR: <strong style={{ color: "#e6eef9" }}>{capture?.qrText ?? "—"}</strong>
        </span>

        {msg ? <span style={{ fontSize: 13, color: msg.startsWith("Error") ? "#b91c1c" : "#166534" }}>{msg}</span> : null}
      </div>
    </section>
  );
}

