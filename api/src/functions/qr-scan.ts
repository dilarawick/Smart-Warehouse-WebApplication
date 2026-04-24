import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import sql from "mssql";
import jpeg from "jpeg-js";
import jsQR from "jsqr";

function header(req: HttpRequest, name: string): string | undefined {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase()) ?? undefined;
}

app.http("qr-scan", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "qr/scan",
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const expectedApiKey = process.env.API_KEY ?? "";
    const apiKey = header(req, "x-api-key") ?? "";
    if (!expectedApiKey || apiKey !== expectedApiKey) {
      return { status: 401, jsonBody: { error: "Unauthorized" } };
    }

    const deviceId = header(req, "x-device-id") ?? "unknown";
    const contentType = header(req, "content-type") ?? "";
    if (!contentType.includes("image/jpeg")) {
      return { status: 415, jsonBody: { error: "Send image/jpeg body" } };
    }

    const jpegBytes = Buffer.from(await req.arrayBuffer());
    if (jpegBytes.length < 100) {
      return { status: 400, jsonBody: { error: "Empty body" } };
    }

    let decoded: { width: number; height: number; data: Uint8Array };
    try {
      decoded = jpeg.decode(jpegBytes, { useTArray: true }) as any;
    } catch (e) {
      ctx.error("JPEG decode failed", e);
      return { status: 400, jsonBody: { error: "Invalid JPEG" } };
    }

    const qr = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    if (!qr?.data) {
      return { status: 422, jsonBody: { error: "No QR found" } };
    }

    const qrText = qr.data;
    const connStr = process.env.SQL_CONNECTION_STRING ?? "";
    if (!connStr) {
      return { status: 500, jsonBody: { error: "SQL_CONNECTION_STRING missing" } };
    }

    const pool = await sql.connect(connStr);
    await pool
      .request()
      .input("DeviceId", sql.NVarChar(64), deviceId)
      .input("QrText", sql.NVarChar(2048), qrText)
      .query(
        `
        INSERT INTO dbo.QrScans(DeviceId, QrText)
        VALUES (@DeviceId, @QrText);
        `
      );

    return { status: 200, jsonBody: { ok: true, deviceId, qrText } };
  },
});

