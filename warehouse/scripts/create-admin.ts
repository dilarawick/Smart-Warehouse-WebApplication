/**
 * Script to create an admin user in the database
 *
 * Usage:
 * 1. Set environment variables in .env.local:
 *    - AZURE_SQL_SERVER
 *    - AZURE_SQL_DATABASE
 *    - AZURE_SQL_USER
 *    - AZURE_SQL_PASSWORD
 * 2. Run: npx tsx scripts/create-admin.ts
 * 3. Enter username and password when prompted
 */

import readline from 'readline';
import path from 'path';
import { config } from 'dotenv';
// Load root .env first (workspace .env), then warehouse/.env.local to allow overrides.
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env.local') });
import { getPool } from '../lib/db';
import { hashPassword } from '../lib/auth';

console.log('Server:', process.env.AZURE_SQL_SERVER || '(not set)');
console.log('DB_CONNECTION_STRING:', process.env.DB_CONNECTION_STRING ? '[provided]' : '(not set)');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function createAdmin() {
  const username: string = await new Promise((resolve) => {
    rl.question('Enter admin username: ', (answer) => resolve(answer.trim()));
  });

  const password: string = await new Promise((resolve) => {
    rl.question('Enter admin password: ', (answer) => resolve(answer.trim()));
  });

  if (!username || !password) {
    console.error('Username and password are required');
    rl.close();
    process.exit(1);
  }

  try {
    const pool = await getPool();

    // Check if user already exists
    const existing = await pool.request()
      .input('username', username)
      .query('SELECT id FROM users WHERE username = @username');

    if (existing.recordset.length > 0) {
      console.error(`User "${username}" already exists`);
      rl.close();
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    await pool.request()
      .input('username', username)
      .input('passwordHash', passwordHash)
      .input('role', 'admin')
      .query(`
        INSERT INTO users (username, password_hash, role)
        VALUES (@username, @passwordHash, @role)
      `);

    console.log(`✅ Admin user "${username}" created successfully!`);
    rl.close();
  } catch (error) {
    console.error('Error creating admin user:', error);
    rl.close();
    process.exit(1);
  }
}

createAdmin();
