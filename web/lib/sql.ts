import sql from "mssql";

declare global {
  // eslint-disable-next-line no-var
  var __sqlPoolPromise: Promise<any> | undefined;
}

export function getSqlPool(): Promise<any> {
  const connStr = process.env.SQL_CONNECTION_STRING ?? "";
  if (!connStr) {
    throw new Error("SQL_CONNECTION_STRING missing");
  }

  if (!global.__sqlPoolPromise) {
    global.__sqlPoolPromise = sql.connect(connStr);
  }

  return global.__sqlPoolPromise!;
}

