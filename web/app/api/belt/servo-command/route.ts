import { getLastServoCommand, setLastServoCommand } from "../../../../lib/last-servo-command";

export const runtime = "nodejs";

function header(req: Request, name: string): string | null {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  try {
    const expected = (process.env.BELT_SERVO_SECRET ?? "").trim();
    if (expected) {
      const got = (header(req, "x-belt-secret") ?? "").trim();
      if (got !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as any;
    const deviceId = String(body?.deviceId ?? "belt-esp32-01").slice(0, 64);
    const angleDeg = Number(body?.angleDeg);
    if (!Number.isFinite(angleDeg)) return Response.json({ error: "angleDeg must be a number" }, { status: 400 });

    const labelRaw = String(body?.label ?? "custom");
    const label = labelRaw === "A" || labelRaw === "B" ? labelRaw : "custom";

    setLastServoCommand({ deviceId, angleDeg, label });
    return Response.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/servo-command][POST]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get("deviceId") ?? "").trim();
    const item = getLastServoCommand();
    if (!item) return Response.json({ item: null }, { status: 200 });
    if (deviceId && item.deviceId !== deviceId) return Response.json({ item: null }, { status: 200 });
    return Response.json({ item }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/belt/servo-command][GET]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

