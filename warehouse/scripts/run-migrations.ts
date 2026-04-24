import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env.local') });

import sql from 'mssql';

async function getPoolLocal(): Promise<sql.ConnectionPool> {
  const config: sql.config = {
    server: process.env.AZURE_SQL_SERVER as string,
    database: process.env.AZURE_SQL_DATABASE as string,
    user: process.env.AZURE_SQL_USER as string,
    password: process.env.AZURE_SQL_PASSWORD as string,
    port: parseInt(process.env.AZURE_SQL_PORT || '1433'),
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
  return await new sql.ConnectionPool(config).connect();
}

async function run() {
  try {
    const migrationsDir = path.resolve(__dirname, '../lib/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const pool = await getPoolLocal();
    const currentDbRes = await pool.request().query('SELECT DB_NAME() AS current_db');
    const currentDb = currentDbRes.recordset?.[0]?.current_db ?? '(unknown)';
    console.log('Running migrations against database:', currentDb);

    // Ensure migrations tracking table exists
    const ensureTableSql = `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'migrations_applied')
      CREATE TABLE migrations_applied (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename NVARCHAR(255) UNIQUE,
        applied_at DATETIME2 DEFAULT GETDATE()
      );`;
    await pool.request().batch(ensureTableSql);

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const already = await pool.request()
        .input('filename', file)
        .query('SELECT 1 FROM migrations_applied WHERE filename = @filename');
      if (already.recordset.length > 0) {
        console.log('Skipping already applied migration:', file);
        continue;
      }

      console.log('Applying migration:', file);
      const sqlText = fs.readFileSync(fullPath, 'utf8');
      // Heuristic: if migration creates tables that already exist, mark as applied and skip
      const createTableRegex = /CREATE\s+TABLE\s+([\[\]"`\w\.]+)/ig;
      let m;
      let skip = false;
      const tablesToCheck: string[] = [];
      while ((m = createTableRegex.exec(sqlText)) !== null) {
        let tbl = m[1];
        // Strip schema if present
        if (tbl.includes('.')) tbl = tbl.split('.').pop() as string;
        tbl = tbl.replace(/[[\]"`]/g, '');
        tablesToCheck.push(tbl);
      }

      try {
        for (const t of tablesToCheck) {
          const res = await pool.request()
            .input('tname', t)
            .query("SELECT 1 FROM sys.tables WHERE name = @tname");
          if (res.recordset.length > 0) {
            console.log(`Table already exists, skipping migration step for ${file}: ${t}`);
            skip = true;
          }
        }

        if (skip && tablesToCheck.length > 0) {
          // mark as applied
          await pool.request()
            .input('filename', file)
            .query('INSERT INTO migrations_applied (filename) VALUES (@filename)');
          console.log('Marked as applied (skipped):', file);
          continue;
        }

        await pool.request().batch(sqlText);
        await pool.request()
          .input('filename', file)
          .query('INSERT INTO migrations_applied (filename) VALUES (@filename)');
        console.log('Applied:', file);
      } catch (migErr) {
        console.error('Failed to apply migration', file, migErr);
        throw migErr;
      }
    }

    console.log('All migrations processed.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

run();
