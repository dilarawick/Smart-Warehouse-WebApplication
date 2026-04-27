import jpeg from "jpeg-js";
import jsQR from "jsqr";
import { fireConveyorSlideWebhook } from "../../../../lib/conveyor-slide";
import { getSqlPool } from "../../../../lib/sql";
import { setLastCaptureFromJpeg } from "../../../../lib/last-capture";

export const runtime = "nodejs";

function downscaleRgbaNearest(
  rgba: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.floor((y * srcH) / dstH);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor((x * srcW) / dstW);
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di + 0] = rgba[si + 0] ?? 0;
      out[di + 1] = rgba[si + 1] ?? 0;
      out[di + 2] = rgba[si + 2] ?? 0;
      out[di + 3] = rgba[si + 3] ?? 255;
    }
  }
  return out;
}

function rotateRgba90CW(rgba: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; w: number; h: number } {
  const out = new Uint8ClampedArray(w * h * 4);
  // (x,y) -> (h-1-y, x) in new image (w'=h, h'=w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const nx = h - 1 - y;
      const ny = x;
      const di = (ny * h + nx) * 4;
      out[di + 0] = rgba[si + 0];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { data: out, w: h, h: w };
}

function tryDecodeQrMultiPass(rgba: Uint8ClampedArray, w: number, h: number) {
  // Try multiple scales to catch QRs at different sizes/positions.
  const scales = [1, 0.75, 0.5, 0.35];

  // Try multiple orientations (camera may be rotated).
  const orientations: Array<{ data: Uint8ClampedArray; w: number; h: number }> = [{ data: rgba, w, h }];
  const r90 = rotateRgba90CW(rgba, w, h);
  const r180 = rotateRgba90CW(r90.data, r90.w, r90.h);
  const r270 = rotateRgba90CW(r180.data, r180.w, r180.h);
  orientations.push(r90, r180, r270);

  for (const o of orientations) {
    for (const s of scales) {
      const w2 = Math.max(64, Math.floor(o.w * s));
      const h2 = Math.max(64, Math.floor(o.h * s));
      const img = s === 1 ? o.data : downscaleRgbaNearest(o.data, o.w, o.h, w2, h2);
      const qr = jsQR(img, w2, h2, { inversionAttempts: "attemptBoth" });
      if (qr?.data) return qr;
    }
  }
  return null;
}

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

    const rgba = new Uint8ClampedArray(decoded.data);
    const qr = tryDecodeQrMultiPass(rgba, decoded.width, decoded.height);
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

    fireConveyorSlideWebhook(qr.data, deviceId);

    return Response.json({ ok: true, qrDecoded: true, deviceId, qrText: qr.data }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/qr/scan]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

