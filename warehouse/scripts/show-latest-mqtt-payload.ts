import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../.env.local') });
config({ path: path.resolve(__dirname, '../../.env') });

import fs from 'fs';
import sql from 'mssql';

async function getPoolLocal(): Promise<sql.ConnectionPool> {
  const config: sql.config = {
    server: process.env.AZURE_SQL_SERVER as string,
    database: process.env.AZURE_SQL_DATABASE as string,
    user: process.env.AZURE_SQL_USER as string,
    password: process.env.AZURE_SQL_PASSWORD as string,
    port: parseInt(process.env.AZURE_SQL_PORT || '1433'),
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
  return await new sql.ConnectionPool(config).connect();
}

async function run() {
  try {
    const pool = await getPoolLocal();
    const res = await pool.request().query('SELECT TOP (1) id, topic, payload, received_at FROM mqtt_payloads ORDER BY received_at DESC');
    if (!res.recordset || res.recordset.length === 0) {
      console.log('No mqtt_payloads rows found');
      process.exit(0);
    }
    const row = res.recordset[0];
    console.log('id:', row.id);
    console.log('topic:', row.topic);
    console.log('received_at:', row.received_at);
    // print truncated payload
    const payload = row.payload as string;
    try {
      const parsed = JSON.parse(payload);
      console.log('Parsed JSON payload keys:', Object.keys(parsed));
      if (parsed.frame_base64 || parsed.image_base64 || parsed.image) {
        const raw = parsed.frame_base64 || parsed.image_base64 || parsed.image;
        const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
        const buf = Buffer.from(base64, 'base64');
        const outDir = path.resolve(__dirname, '../tmp');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `mqtt_payload_image_${Date.now()}.jpg`);
        fs.writeFileSync(outPath, buf);
        console.log('Saved embedded image to', outPath);
      }
      if (parsed.frame_url) console.log('frame_url:', parsed.frame_url);
      if (parsed.id) console.log('id:', parsed.id);
    } catch (e) {
      console.log('Raw payload (truncated):', payload.substring(0, 1000));
    }
  } catch (err) {
    console.error('Error querying mqtt_payloads:', err);
    process.exit(1);
  }
}

run();
