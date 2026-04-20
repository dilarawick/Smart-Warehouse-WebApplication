import path from 'path';
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env.local') });

import { getPool } from '../lib/db';

async function run() {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT DB_NAME() AS current_db; SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'users';"
    );

    const currentDb = result.recordsets && result.recordsets[0] && result.recordsets[0][0]
      ? result.recordsets[0][0].current_db
      : '(unknown)';

    const tables = result.recordsets && result.recordsets[1] ? result.recordsets[1] : [];

    console.log('Current database:', currentDb);
    if (tables.length === 0) {
      console.log("'users' table: NOT FOUND");
    } else {
      console.log("'users' table found in schema(s):", tables.map((t: any) => t.TABLE_SCHEMA).join(', '));
    }
  } catch (err) {
    console.error('Error checking database:', err);
    process.exit(1);
  }
}

run();
