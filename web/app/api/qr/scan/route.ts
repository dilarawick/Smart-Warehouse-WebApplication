import jpeg from "jpeg-js";
import jsQR from "jsqr";
import sql from "mssql";
import { getSqlPool } from "../../../../lib/sql";
import { setLastCaptureFromJpeg } from "../../../../lib/last-capture";

export const runtime = "nodejs";

function header(req: Request, name: string): string | null {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  try {
    // Auth is optional: if API_KEY is set, enforce it; otherwise allow (useful for local/dev).
    const expectedApiKey = process.env.API_KEY ?? "";
    if (expectedApiKey) {
      const apiKey = header(req, "x-api-key") ?? "";
      if (apiKey !== expectedApiKey) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const deviceId = header(req, "x-device-id") ?? "unknown";
    const contentType = header(req, "content-type") ?? "";
    if (!contentType.includes("image/jpeg")) {
      return Response.json({ error: "Send image/jpeg body" }, { status: 415 });
    }

    const jpegBytes = Buffer.from(await req.arrayBuffer());
    if (jpegBytes.length < 100) {
      return Response.json({ error: "Empty body" }, { status: 400 });
    }

    let decoded: { width: number; height: number; data: Uint8Array };
    try {
      decoded = jpeg.decode(jpegBytes, { useTArray: true }) as any;
    } catch {
      return Response.json({ error: "Invalid JPEG" }, { status: 400 });
    }

    const qr = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    if (!qr?.data) {
      setLastCaptureFromJpeg({
        jpegBuffer: jpegBytes,
        deviceId,
        status: "no_qr",
      });
      return Response.json({ error: "No QR found" }, { status: 422 });
    }

    setLastCaptureFromJpeg({
      jpegBuffer: jpegBytes,
      deviceId,
      status: "decoded",
      qrText: qr.data,
    });

    const pool = await getSqlPool();
    await pool
      .request()
      .input("DeviceId", sql.NVarChar(64), deviceId)
      .input("QrText", sql.NVarChar(2048), qr.data)
      .query(
        `
        INSERT INTO dbo.QrScans(DeviceId, QrText)
        VALUES (@DeviceId, @QrText);
        `
      );

    return Response.json({ ok: true, deviceId, qrText: qr.data }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/qr/scan]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

