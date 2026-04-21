import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';

// ---------------------------------------------------------------
// POST /api/scan
//
// Accepts JSON from the ESP32-CAM (already decoded on-device):
//   { box_id, belt_id, raw_payload, device_ip }
//
// Also accepts the legacy web-scanner JSON body:
//   { qr_data, belt_id, source_id }
//
// The old multipart/image approach has been removed — the ESP32
// decodes the QR code itself with ZXing and sends only text.
// ---------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let box_id: string;
    let belt_id: string;
    let raw_payload: string;
    let ip_address: string;

    if (contentType.includes('application/json')) {
      const body = await request.json();

      // ESP32 firmware sends: { box_id, belt_id, raw_payload, device_ip }
      // Web scanner sends:    { qr_data, belt_id, source_id }
      box_id     = (body.box_id   || body.qr_data   || '').trim();
      belt_id    = (body.belt_id  || 'Belt-1').trim();
      raw_payload = body.raw_payload || JSON.stringify(body);
      ip_address = body.device_ip || body.source_id || 'unknown';
    } else {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 },
      );
    }

    if (!box_id) {
      return NextResponse.json({ error: 'box_id is required' }, { status: 400 });
    }

    const pool = await getPool();

    // Optional product lookup
    let product_id: string | null   = null;
    let product_name: string | null = null;
    let category: string | null     = null;

    try {
      const productResult = await pool.request()
        .input('product_id', sql.VarChar, box_id)
        .query('SELECT product_id, product_name, category FROM products WHERE product_id = @product_id');

      if (productResult.recordset.length > 0) {
        const p = productResult.recordset[0];
        product_id   = p.product_id;
        product_name = p.product_name;
        category     = p.category;
      }
    } catch (lookupErr) {
      console.warn('[SCAN] Product lookup failed (non-fatal):', lookupErr);
    }

    // Duplicate check — same box scanned within last 60 seconds
    const dup = await pool.request()
      .input('box_id', sql.VarChar, box_id)
      .query(`
        SELECT 1 FROM box_scans
        WHERE box_id = @box_id
          AND scan_time > DATEADD(SECOND, -60, GETDATE())
      `);

    const status = dup.recordset.length > 0 ? 'duplicate' : 'ok';

    await pool.request()
      .input('box_id',       sql.VarChar, box_id)
      .input('product_id',   sql.VarChar, product_id)
      .input('product_name', sql.VarChar, product_name)
      .input('category',     sql.VarChar, category)
      .input('belt_id',      sql.VarChar, belt_id)
      .input('status',       sql.VarChar, status)
      .input('raw_payload',  sql.VarChar, raw_payload)
      .input('ip_address',   sql.VarChar, ip_address)
      .query(`
        INSERT INTO box_scans
          (box_id, product_id, product_name, category, belt_id, status, raw_payload, ip_address)
        VALUES
          (@box_id, @product_id, @product_name, @category, @belt_id, @status, @raw_payload, @ip_address)
      `);

    console.log(`[SCAN] Saved: ${box_id} → ${status} | Product: ${product_name || 'unknown'} | Belt: ${belt_id} | IP: ${ip_address}`);

    return NextResponse.json({
      success: true,
      box_id,
      product_id,
      product_name,
      category,
      status,
    });
  } catch (err) {
    console.error('[SCAN POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
