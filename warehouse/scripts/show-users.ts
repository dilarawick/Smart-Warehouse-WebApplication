import path from 'path';
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env.local') });

import { getPool } from '../lib/db';

async function run() {
  try {
    const pool = await getPool();
    const currentDbRes = await pool.request().query('SELECT DB_NAME() AS current_db');
    const currentDb = currentDbRes.recordset?.[0]?.current_db ?? '(unknown)';
    console.log('Connected database:', currentDb);

    const cols = await pool.request()
      .query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' ORDER BY ORDINAL_POSITION");

    if (!cols.recordset || cols.recordset.length === 0) {
      console.log("No 'users' table columns found.");
    } else {
      console.log("'users' table columns:");
      cols.recordset.forEach((c: any) => console.log(` - ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
    }

    const rows = await pool.request().query('SELECT TOP (10) id, username, role, created_at FROM users ORDER BY id DESC');
    console.log('Top rows (up to 10):');
    console.table(rows.recordset || []);
  } catch (err: any) {
    console.error('Error querying users table:', err.message || err);
    process.exit(1);
  }
}

run();
