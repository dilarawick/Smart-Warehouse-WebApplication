import jpeg from "jpeg-js";
import jsQR from "jsqr";
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
      // 200 so simple clients (e.g. ESP32 checking for "200") treat upload as OK.
      // No row inserted — only frames with a decoded QR go to dbo.QrScans.
      return Response.json(
        { ok: true, qrDecoded: false, deviceId, message: "No QR found in frame" },
        { status: 200 }
      );
    }

    setLastCaptureFromJpeg({
      jpegBuffer: jpegBytes,
      deviceId,
      status: "decoded",
      qrText: qr.data,
    });

    const pool = await getSqlPool();
    // Use two-arg .input(name, value) so types are inferred inside mssql (getTypeByValue).
    // Explicit sql.NVarChar(...) from the package default export can intermittently break
    // under Next/Webpack (EPARAM: parameter.type.validate is not a function).
    await pool
      .request()
      .input("DeviceId", deviceId.slice(0, 64))
      .input("QrText", qr.data.slice(0, 2048))
      .query(
        `
        INSERT INTO dbo.QrScans(DeviceId, QrText)
        VALUES (@DeviceId, @QrText);
        `
      );

    return Response.json({ ok: true, qrDecoded: true, deviceId, qrText: qr.data }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/qr/scan]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

