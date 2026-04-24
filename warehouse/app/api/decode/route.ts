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

// jsqr needs a 4-channel RGBA Uint8ClampedArray.
// Jimp bitmap.data is a Node Buffer that may share its ArrayBuffer at a
// non-zero byteOffset — Buffer.from(data) gives a fresh zero-offset copy.
function tryDecodeQR(image: Jimp, label: string): string | null {
  const { data, width, height } = image.bitmap;
  const rgba = new Uint8ClampedArray(Buffer.from(data));

  let result = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  if (result?.data) {
    console.log(`[DECODE] Found QR (${label}, normal): ${result.data.substring(0, 80)}`);
    return result.data;
  }

  result = jsQR(rgba, width, height, { inversionAttempts: 'onlyInvert' });
  if (result?.data) {
    console.log(`[DECODE] Found QR (${label}, inverted): ${result.data.substring(0, 80)}`);
    return result.data;
  }

  console.log(`[DECODE] No QR: ${label} (${width}x${height})`);
  return null;
}

async function decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
  console.log(`[DECODE] Buffer size: ${buffer.length} bytes`);

  let baseImage: Jimp;
  try {
    baseImage = await Jimp.read(buffer);
  } catch (e) {
    console.error('[DECODE] Jimp.read failed:', e);
    return null;
  }

  const { width, height } = baseImage.bitmap;
  console.log(`[DECODE] Image dimensions: ${width}x${height}`);

  // Upscale very small images
  let work = baseImage;
  if (width < 400 || height < 300) {
    const scale = Math.max(400 / width, 300 / height);
    work = baseImage.clone().resize(
      Math.round(width * scale),
      Math.round(height * scale),
      Jimp.RESIZE_BICUBIC
    );
    console.log(`[DECODE] Upscaled to ${work.bitmap.width}x${work.bitmap.height}`);
  }

  // Strategy 1: raw image (colour)
  let qr = tryDecodeQR(work, 'raw');
  if (qr) return qr;

  // Strategy 2: grayscale
  const grey = work.clone().greyscale();
  qr = tryDecodeQR(grey, 'grey');
  if (qr) return qr;

  // Strategy 3: greyscale + high contrast
  qr = tryDecodeQR(grey.clone().contrast(0.8), 'grey+c0.8');
  if (qr) return qr;

  // Strategy 4: greyscale + max contrast (binary-like threshold)
  qr = tryDecodeQR(grey.clone().contrast(1.0), 'grey+c1.0');
  if (qr) return qr;

  // Strategy 5: greyscale + brightened (for dark/underlit prints)
  qr = tryDecodeQR(grey.clone().brightness(0.2).contrast(0.6), 'grey+bright+c0.6');
  if (qr) return qr;

  // Strategy 6: greyscale + darkened (for overexposed bright prints)
  qr = tryDecodeQR(grey.clone().brightness(-0.2).contrast(0.8), 'grey+dark+c0.8');
  if (qr) return qr;

  // Strategy 7: sharpen + contrast (helps with blur from ESP32-CAM)
  qr = tryDecodeQR(grey.clone().convolute([
    [ 0, -1,  0],
    [-1,  5, -1],
    [ 0, -1,  0],
  ]).contrast(0.8), 'grey+sharpen+c0.8');
  if (qr) return qr;

  // Strategy 8: 2x upscale (helps marginal/blurry QR codes)
  qr = tryDecodeQR(work.clone().scale(2, Jimp.RESIZE_BICUBIC).greyscale().contrast(0.8), '2x+grey+c0.8');
  if (qr) return qr;

  // Strategy 9: centre crop 80% (removes camera-edge noise)
  const cw = Math.round(work.bitmap.width * 0.8);
  const ch = Math.round(work.bitmap.height * 0.8);
  const cx = Math.round((work.bitmap.width - cw) / 2);
  const cy = Math.round((work.bitmap.height - ch) / 2);
  qr = tryDecodeQR(work.clone().crop(cx, cy, cw, ch).greyscale().contrast(0.8), 'crop80+grey+c0.8');
  if (qr) return qr;

  // Strategy 10: 3x upscale greyscale (last resort for very blurry)
  qr = tryDecodeQR(work.clone().scale(3, Jimp.RESIZE_BICUBIC).greyscale().contrast(1.0), '3x+grey+c1.0');
  if (qr) return qr;

  console.log('[DECODE] All strategies exhausted — QR not found');
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[DECODE API] Keys received:', Object.keys(body));

    let buffer: Buffer | null = extractImageBuffer(body);

    if (buffer) {
      console.log(`[DECODE API] Base64 image received, buffer: ${buffer.length} bytes`);
    }

    if (!buffer && body.frame_url) {
      console.log('[DECODE API] Fetching frame URL:', body.frame_url);
      const res = await fetch(body.frame_url, { cache: 'no-store' });
      if (!res.ok) {
        console.error(`[DECODE API] Fetch failed: ${res.status}`);
        return NextResponse.json({ error: `Failed: ${res.status}`, success: false }, { status: 200 });
      }
      buffer = Buffer.from(await res.arrayBuffer());
      console.log(`[DECODE API] Fetched frame, buffer: ${buffer.length} bytes`);
    }

    if (!buffer) {
      console.error('[DECODE API] No image data provided');
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

    const belt_id = body.belt_id || body.belt || 'Belt-1';
    const product_id = qrParsed?.product_id || null;
    const product_name = qrParsed?.product_name || null;
    const category = qrParsed?.category || null;

    // Save scan to DB
    let status = 'ok';
    try {
      const pool = await getPool();
      // dedupe within 60s
      try {
        const dup = await pool.request()
          .input('box_id', sql.VarChar, box_id)
          .query(`SELECT 1 FROM box_scans WHERE box_id = @box_id AND scan_time > DATEADD(SECOND, -60, GETDATE())`);
        status = dup.recordset.length > 0 ? 'duplicate' : 'ok';
      } catch (e) {
        console.error('[DECODE API] duplicate check failed', e);
      }

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
    } catch (dbErr: any) {
      console.error('[DECODE API] DB save failed', dbErr.message);
      status = 'db_error';
      // Do not return 500 here! We must proceed to publish the MQTT ACK
      // so the ESP32-CAM and dashboard don't hang, even if SQL is offline.
    }

    console.log('[DECODE API] QR decoded and saved:', qrData.substring(0, 100));

    // Publish ack to MQTT
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
          try { client.end(); } catch (_) {}
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
