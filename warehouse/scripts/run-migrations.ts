import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env.local') });

import { getPool } from '../lib/db';

async function run() {
  try {
    const migrationPath = path.resolve(__dirname, '../lib/migrations/001_create_users_table.sql');
    const sqlText = fs.readFileSync(migrationPath, 'utf8');

    const pool = await getPool();

    const currentDbRes = await pool.request().query('SELECT DB_NAME() AS current_db');
    const currentDb = currentDbRes.recordset?.[0]?.current_db ?? '(unknown)';
    console.log('Running migrations against database:', currentDb);

    // Execute the migration file as a batch. SQL comments (--) are ignored by SQL Server.
    await pool.request().batch(sqlText);

    console.log('Migrations applied successfully.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

run();
