import { getSqlPool } from "../../../../lib/sql";

export const runtime = "nodejs";

function header(req: Request, name: string): string | null {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  try {
    // Optional shared secret (recommended). If set, ESP32 must send x-belt-secret.
    const expected = (process.env.BELT_EVENTS_SECRET ?? "").trim();
    if (expected) {
      const got = (header(req, "x-belt-secret") ?? "").trim();
      if (got !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as any;
    const deviceId = String(body?.deviceId ?? "unknown").slice(0, 64);
    const eventType = String(body?.eventType ?? "status").slice(0, 32);
    const gateState = String(body?.gateState ?? "unknown").slice(0, 16);
    const beltState = String(body?.beltState ?? "unknown").slice(0, 16);
    const qrText = body?.qrText == null ? null : String(body.qrText).slice(0, 2048);
    const note = body?.note == null ? null : String(body.note).slice(0, 512);

    const pool = await getSqlPool();
    await pool
      .request()
      .input("DeviceId", deviceId)
      .input("EventType", eventType)
      .input("GateState", gateState)
      .input("BeltState", beltState)
      .input("QrText", qrText)
      .input("Note", note)
      .query(
        `
        INSERT INTO dbo.BeltEvents(DeviceId, EventType, GateState, BeltState, QrText, Note)
        VALUES (@DeviceId, @EventType, @GateState, @BeltState, @QrText, @Note);
        `
      );

    return Response.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/events][POST]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get("limit") ?? "50";
    const limit = Math.max(1, Math.min(200, Math.floor(Number(limitRaw) || 50)));

    const pool = await getSqlPool();
    const result = await pool.request().query(`
        SELECT TOP (${limit})
          Id, DeviceId, EventType, GateState, BeltState, QrText, Note, CreatedAtUtc
        FROM dbo.BeltEvents
        ORDER BY CreatedAtUtc DESC, Id DESC;
      `);

    return Response.json({ items: result.recordset }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/events][GET]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

