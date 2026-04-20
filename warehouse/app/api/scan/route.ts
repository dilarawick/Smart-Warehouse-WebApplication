import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import jsQR from 'jsqr';

export async function POST(request: Request) {
  try {
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

    const box_id = qr.data;
    const belt_id = formData.get('belt_id') as string || 'Belt-1';
    const source_id = formData.get('source_id') as string || 'unknown';

    const pool = await getPool();

    let product_id = null;
    let product_name = null;
    let category = null;
    
    const productResult = await pool.request()
      .input('product_id', sql.VarChar, box_id)
      .query('SELECT product_id, product_name, category FROM products WHERE product_id = @product_id');
    
    if (productResult.recordset.length > 0) {
      const product = productResult.recordset[0];
      product_id = product.product_id;
      product_name = product.product_name;
      category = product.category;
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
      .input('category',      sql.VarChar, category)
      .input('belt_id',       sql.VarChar, belt_id)
      .input('status',        sql.VarChar, status)
      .input('raw_payload',   sql.VarChar, JSON.stringify({ qr: box_id, source: source_id }))
      .input('ip_address',    sql.VarChar, source_id)
      .query(`
        INSERT INTO box_scans (box_id, product_id, product_name, category, belt_id, status, raw_payload, ip_address)
        VALUES (@box_id, @product_id, @product_name, @category, @belt_id, @status, @raw_payload, @ip_address)
      `);

    console.log(`[SCAN] Saved: ${box_id} → ${status} | Product: ${product_name || 'unknown'}`);

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