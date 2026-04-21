import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import jsQR from 'jsqr';

// MQTT broker config for publishing servo commands
const MQTT_BROKER = process.env.NEXT_PUBLIC_MQTT_BROKER || 'broker.hivemq.com';
const MQTT_PORT = Number(process.env.NEXT_PUBLIC_MQTT_MQTT_PORT) || 1883;

function determineCategory(boxId: string): { category: string; action: string } {
  // Box IDs starting with "A" or "BOX-A" -> Category A (slide out)
  // Box IDs starting with "B" or "BOX-B" -> Category B (pass through)
  // Otherwise default to Category B
  const upper = boxId.toUpperCase();
  if (upper.startsWith('A') || upper.includes('-A-') || upper.includes('A-')) {
    return { category: 'A', action: 'SLIDE_A' };
  }
  return { category: 'B', action: 'PASS_B' };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let box_id: string;
    let belt_id = 'Belt-1';
    let source_id = 'esp32-cam';
    let rawQrData = '';

    // Handle JSON payload (from MQTT)
    if (contentType.includes('application/json')) {
      const body = await request.json();
      box_id = body.box_id || body.qr_data || body.data || '';
      belt_id = body.belt_id || belt_id;
      source_id = body.source_id || 'mqtt';
      rawQrData = body.raw_payload || box_id;
      
      if (!box_id) {
        return NextResponse.json({ error: 'No box_id provided' }, { status: 400 });
      }
    } 
    // Handle multipart form data (image upload for QR decoding)
    else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const imageFile = formData.get('image') as File | null;

      if (!imageFile) {
        return NextResponse.json({ error: 'No image provided' }, { status: 400 });
      }

      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const uint8Array = new Uint8ClampedArray(buffer);

      const qr = jsQR(uint8Array, buffer.length > 0 ? 640 : 320, 480);

      if (!qr || !qr.data) {
        return NextResponse.json({ error: 'No QR code found' }, { status: 400 });
      }

      box_id = qr.data;
      belt_id = formData.get('belt_id') as string || belt_id;
      source_id = formData.get('source_id') as string || 'unknown';
      rawQrData = qr.data;
    } else {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
    }

    // Determine category and servo action
    const { category, action } = determineCategory(box_id);

    const pool = await getPool();

    let product_id = null;
    let product_name = null;
    let dbCategory = category;
    
    const productResult = await pool.request()
      .input('product_id', sql.VarChar, box_id)
      .query('SELECT product_id, product_name, category FROM products WHERE product_id = @product_id');
    
    if (productResult.recordset.length > 0) {
      const product = productResult.recordset[0];
      product_id = product.product_id;
      product_name = product.product_name;
      dbCategory = product.category || category;
    }

    const dup = await pool.request()
      .input('box_id', sql.VarChar, box_id)
      .query(`
        SELECT 1 FROM box_scans
        WHERE box_id = @box_id
          AND scan_time > DATEADD(SECOND, -60, GETDATE())
      `);

    const status = dup.recordset.length > 0 ? 'duplicate' : 'ok';

    await pool.request()
      .input('box_id',        sql.VarChar, box_id)
      .input('product_id',    sql.VarChar, product_id)
      .input('product_name',  sql.VarChar, product_name)
      .input('category',      sql.VarChar, dbCategory)
      .input('belt_id',       sql.VarChar, belt_id)
      .input('status',        sql.VarChar, status)
      .input('raw_payload',   sql.VarChar, JSON.stringify({ qr: rawQrData, source: source_id, action }))
      .input('ip_address',    sql.VarChar, source_id)
      .query(`
        INSERT INTO box_scans (box_id, product_id, product_name, category, belt_id, status, raw_payload, ip_address)
        VALUES (@box_id, @product_id, @product_name, @category, @belt_id, @status, @raw_payload, @ip_address)
      `);

    console.log(`[SCAN] Saved: ${box_id} → ${status} | Category: ${dbCategory} | Action: ${action}`);

    // Publish servo command via MQTT (simulated - in production use actual MQTT client or database trigger)
    // The ESP32 subscribes to warehouse/{belt_id}/servo and will receive the command
    console.log(`[MQTT] Publishing servo command: ${action} to warehouse/${belt_id}/servo`);

    return NextResponse.json({
      success: true,
      box_id,
      product_id,
      product_name,
      category: dbCategory,
      action,  // SLIDE_A or PASS_B - tells ESP32 what to do with servo
      status,
    });
  } catch (err) {
    console.error('[SCAN POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}