import { getLastBeltTelemetry, setLastBeltTelemetry } from "../../../../lib/last-belt-telemetry";

export const runtime = "nodejs";

function header(req: Request, name: string): string | null {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  try {
    // Optional shared secret (recommended). If set, ESP32 must send x-belt-secret.
    const expected = (process.env.BELT_TELEMETRY_SECRET ?? "").trim();
    if (expected) {
      const got = (header(req, "x-belt-secret") ?? "").trim();
      if (got !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as any;
    setLastBeltTelemetry({
      deviceId: String(body?.deviceId ?? "unknown"),
      lcdLine1: String(body?.lcdLine1 ?? ""),
      lcdLine2: String(body?.lcdLine2 ?? ""),
      temperatureC: body?.temperatureC == null ? null : Number(body.temperatureC),
      humidityPct: body?.humidityPct == null ? null : Number(body.humidityPct),
      updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : undefined,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/telemetry][POST]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    return Response.json({ item: getLastBeltTelemetry() ?? null }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/telemetry][GET]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

