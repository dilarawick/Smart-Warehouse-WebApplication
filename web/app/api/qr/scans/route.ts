import { getSqlPool } from "../../../../lib/sql";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get("limit") ?? "50";
    // Integer 1..200 only — safe to interpolate for TOP (avoids mssql/tedious Int param edge cases under Next bundling).
    const limit = Math.max(1, Math.min(200, Math.floor(Number(limitRaw) || 50)));

    const pool = await getSqlPool();
    const result = await pool.request().query(`
        SELECT TOP (${limit})
          Id, DeviceId, QrText, ScannedAtUtc
        FROM dbo.QrScans
        ORDER BY ScannedAtUtc DESC, Id DESC;
      `);

    return Response.json({ items: result.recordset }, { status: 200 });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unknown error";
    console.error("[api/qr/scans]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

