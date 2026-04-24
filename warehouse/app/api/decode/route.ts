import { NextResponse } from 'next/server';
import Jimp from 'jimp';
import jsQR from 'jsqr';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import mqtt from 'mqtt';

function extractImageBuffer(body: any): Buffer | null {
  if (body.image_base64 || body.frame_base64 || body.image) {
    const raw = body.image_base64 || body.frame_base64 || body.image;
    const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
    return Buffer.from(base64, 'base64');
  }
  return null;
}

// jsqr needs a 4-channel RGBA Uint8ClampedArray — exactly what Jimp's bitmap.data is.
function tryDecodeQR(image: Jimp): string | null {
  const { data, width, height } = image.bitmap;
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);

  // Try normal orientation
  let result = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  if (result?.data) return result.data;

  // Try with inversion (handles white-on-black QR codes)
  result = jsQR(rgba, width, height, { inversionAttempts: 'onlyInvert' });
  if (result?.data) return result.data;

  return null;
}

async function decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
  const baseImage = await Jimp.read(buffer);
  const { width, height } = baseImage.bitmap;

  // Upscale very small images
  let work = baseImage;
  if (width < 400 || height < 300) {
    const scale = Math.max(400 / width, 300 / height);
    work = baseImage.clone().resize(
      Math.round(width * scale),
      Math.round(height * scale),
      Jimp.RESIZE_BICUBIC
    );
  }

  // Strategy 1: raw image
  let qr = tryDecodeQR(work);
  if (qr) return qr;

  // Strategy 2: grayscale (removes colour noise)
  const grey = work.clone().greyscale();
  qr = tryDecodeQR(grey);
  if (qr) return qr;

  // Strategy 3: greyscale + high contrast
  const highContrast = grey.clone().contrast(0.8);
  qr = tryDecodeQR(highContrast);
  if (qr) return qr;

  // Strategy 4: greyscale + max contrast (binarise)
  const binarised = grey.clone().contrast(1.0);
  qr = tryDecodeQR(binarised);
  if (qr) return qr;

  // Strategy 5: greyscale slightly brightened (overexposed prints)
  const bright = grey.clone().brightness(0.2).contrast(0.6);
  qr = tryDecodeQR(bright);
  if (qr) return qr;

  // Strategy 6: sharpen then binarise
  const sharp = grey.clone().convolute([
    [ 0, -1,  0],
    [-1,  5, -1],
    [ 0, -1,  0],
  ]).contrast(0.8);
  qr = tryDecodeQR(sharp);
  if (qr) return qr;

  // Strategy 7: scale up 2x (helps with small/blurry QRs)
  const big = work.clone().scale(2, Jimp.RESIZE_BICUBIC).greyscale().contrast(0.8);
  qr = tryDecodeQR(big);
  if (qr) return qr;

  // Strategy 8: centre crop (removes edge clutter)
  const cw = Math.round(work.bitmap.width * 0.8);
  const ch = Math.round(work.bitmap.height * 0.8);
  const cx = Math.round((work.bitmap.width - cw) / 2);
  const cy = Math.round((work.bitmap.height - ch) / 2);
  const cropped = work.clone().crop(cx, cy, cw, ch).greyscale().contrast(0.8);
  qr = tryDecodeQR(cropped);
  if (qr) return qr;

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let buffer: Buffer | null = extractImageBuffer(body);

    if (!buffer && body.frame_url) {
      console.log('[DECODE API] Fetching frame:', body.frame_url);
      const res = await fetch(body.frame_url, { cache: 'no-store' });
      if (!res.ok) {
        return NextResponse.json({ error: `Failed: ${res.status}`, success: false }, { status: 200 });
      }
      buffer = Buffer.from(await res.arrayBuffer());
    }

    if (!buffer) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const qrData = await decodeQrFromBuffer(buffer);

    if (!qrData) {
      return NextResponse.json({ success: false, qr_data: null, error: 'No QR found' });
    }

    // Normalize and try to parse structured QR
    let box_id: string = qrData;
    let qrParsed: { product_id?: string; product_name?: string; category?: string } | null = null;
    try { qrParsed = JSON.parse(qrData); } catch {}
    if (qrParsed) box_id = qrParsed.product_id || box_id;

    // Save scan to DB
    try {
      const pool = await getPool();
      // dedupe within 60s
      let status = 'ok';
      try {
        const dup = await pool.request()
          .input('box_id', sql.VarChar, box_id)
          .query(`SELECT 1 FROM box_scans WHERE box_id = @box_id AND scan_time > DATEADD(SECOND, -60, GETDATE())`);
        status = dup.recordset.length > 0 ? 'duplicate' : 'ok';
      } catch (e) {
        console.error('[DECODE API] duplicate check failed', e);
      }

      const belt_id = body.belt_id || body.belt || 'Belt-1';
      const product_id = qrParsed?.product_id || null;
      const product_name = qrParsed?.product_name || null;
      const category = qrParsed?.category || null;

      await pool.request()
        .input('box_id', sql.VarChar, box_id)
        .input('product_id', sql.VarChar, product_id)
        .input('product_name', sql.VarChar, product_name)
        .input('category', sql.VarChar, category)
        .input('belt_id', sql.VarChar, belt_id)
        .input('status', sql.VarChar, status)
        .input('raw_payload', sql.NVarChar(sql.MAX), JSON.stringify({ qr: qrData, source: body }))
        .input('ip_address', sql.VarChar, body.esp_ip || 'server')
        .query(`
          INSERT INTO box_scans (box_id, product_id, product_name, category, belt_id, status, raw_payload, ip_address)
          VALUES (@box_id, @product_id, @product_name, @category, @belt_id, @status, @raw_payload, @ip_address)
        `);
    } catch (dbErr) {
      console.error('[DECODE API] DB save failed', dbErr);
      return NextResponse.json({ success: false, qr_data: qrData, error: 'DB save failed' }, { status: 500 });
    }

    console.log('[DECODE API] QR decoded and saved:', qrData.substring(0, 100));

    // Publish ack to MQTT so dashboards/ESP can consume result
    try {
      const brokerHost = process.env.MQTT_BROKER || 'broker.hivemq.com';
      const brokerProtocol = process.env.MQTT_PROTOCOL || 'mqtts';
      const brokerPort = process.env.MQTT_PORT ? `:${process.env.MQTT_PORT}` : '';
      const connectUrl = `${brokerProtocol}://${brokerHost}${brokerPort}`;
      const clientId = process.env.MQTT_SERVER_ID || `nextjs-decode-${Math.random().toString(16).slice(2)}`;
      const opts: any = { clientId, rejectUnauthorized: false };
      if (process.env.MQTT_USER) opts.username = process.env.MQTT_USER;
      if (process.env.MQTT_PASSWORD) opts.password = process.env.MQTT_PASSWORD;

      const client = mqtt.connect(connectUrl, opts);
      const ackTopic = `warehouse/${belt_id}/scan/ack`;
      const ackPayload = { status, box_id, product_id, product_name, category: category ? 'found' : 'not_found', timestamp: new Date().toISOString(), server: clientId };

      client.on('connect', () => {
        try {
          client.publish(ackTopic, JSON.stringify(ackPayload), { qos: 0, retain: false }, () => {
            client.end();
          });
        } catch (e) {
          console.error('[DECODE API] MQTT publish error', e);
          try { client.end(); } catch(_) {}
        }
      });
    } catch (pubErr) {
      console.error('[DECODE API] MQTT ack failed', pubErr);
    }

    return NextResponse.json({ success: true, qr_data: qrData });
  } catch (err) {
    console.error('[DECODE API] Error:', err);
    return NextResponse.json({ error: String(err), success: false }, { status: 200 });
  }
}
