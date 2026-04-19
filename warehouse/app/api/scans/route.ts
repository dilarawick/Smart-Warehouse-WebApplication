import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { startMqttSubscriber } from '@/lib/mqttSubscriber';

startMqttSubscriber();

export async function GET() {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 100
        id, box_id, belt_id, status, raw_payload, ip_address,
        FORMAT(scan_time, 'yyyy-MM-dd HH:mm:ss') AS scan_time
      FROM box_scans
      ORDER BY scan_time DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('[scans GET]', err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
