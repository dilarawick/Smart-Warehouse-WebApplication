import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import sql from "mssql";

app.http("qr-scans", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "qr/scans",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const limitRaw = req.query.get("limit") ?? "50";
    const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));

    const connStr = process.env.SQL_CONNECTION_STRING ?? "";
    if (!connStr) {
      return { status: 500, jsonBody: { error: "SQL_CONNECTION_STRING missing" } };
    }

    const pool = await sql.connect(connStr);
    const result = await pool
      .request()
      .input("Limit", sql.Int, limit)
      .query(
        `
        SELECT TOP (@Limit)
          Id, DeviceId, QrText, ScannedAtUtc
        FROM dbo.QrScans
        ORDER BY ScannedAtUtc DESC, Id DESC;
        `
      );

    return { status: 200, jsonBody: { items: result.recordset } };
  },
});

