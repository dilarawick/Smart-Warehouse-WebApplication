import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Jimp from 'jimp';
import { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import sql from 'mssql';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env.local') });
config({ path: path.resolve(__dirname, '../../.env') });

const zxingReader = new MultiFormatReader();

function extractLuminanceArray(image: Jimp): Uint8ClampedArray {
  const { data, width, height } = image.bitmap;
  const luminanceArray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luminanceArray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) & 0xFF;
  }
  return luminanceArray;
}

async function decodeWithZxing(image: Jimp): Promise<string | null> {
  const { width, height } = image.bitmap;
  const luminanceArray = extractLuminanceArray(image);
  const luminanceSource = new RGBLuminanceSource(luminanceArray, width, height);
  const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
  try {
    const result = zxingReader.decode(binaryBitmap);
    return result.getText();
  } catch (_) {
    return null;
  }
}

async function decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
  const baseImage = await Jimp.read(buffer);
  let work = baseImage;
  const originalWidth = baseImage.bitmap.width;
  const originalHeight = baseImage.bitmap.height;
  if (originalWidth < 640 || originalHeight < 480) {
    const scale = Math.max(640 / originalWidth, 480 / originalHeight);
    work = baseImage.clone().resize(Math.round(originalWidth * scale), Math.round(originalHeight * scale), Jimp.RESIZE_NEAREST_NEIGHBOR);
  }

  let qr = await decodeWithZxing(work);
  if (qr) return qr;

  const img2 = work.clone(); img2.contrast(1.0).brightness(0.05);
  qr = await decodeWithZxing(img2); if (qr) return qr;

  const img3 = work.clone().invert(); img3.contrast(1.0);
  qr = await decodeWithZxing(img3); if (qr) return qr;

  const img4 = work.clone().greyscale(); img4.contrast(0.8);
  qr = await decodeWithZxing(img4); if (qr) return qr;

  try {
    const w = work.bitmap.width; const h = work.bitmap.height;
    const size = Math.round(Math.min(w, h) * 0.8);
    const x = Math.max(0, Math.round((w - size) / 2));
    const y = Math.max(0, Math.round((h - size) / 2));
    const cropped = work.clone().crop(x, y, size, size);
    try { const sharpenKernel = [[0,-1,0],[-1,5,-1],[0,-1,0]]; cropped.convolute && cropped.convolute(sharpenKernel); } catch(_){}
    qr = await decodeWithZxing(cropped); if (qr) return qr;
    const cg = cropped.clone().greyscale().contrast(0.8); qr = await decodeWithZxing(cg); if (qr) return qr;
  } catch(_){}

  for (const deg of [90,180,270]) {
    try { const r = work.clone().rotate(deg, false); qr = await decodeWithZxing(r); if (qr) return qr; } catch(_){}
  }

  return null;
}

async function getPool() {
  const configDb: sql.config = {
    server: process.env.AZURE_SQL_SERVER as string,
    database: process.env.AZURE_SQL_DATABASE as string,
    user: process.env.AZURE_SQL_USER as string,
    password: process.env.AZURE_SQL_PASSWORD as string,
    port: parseInt(process.env.AZURE_SQL_PORT || '1433'),
    options: { encrypt: true, trustServerCertificate: false }
  };
  return await new sql.ConnectionPool(configDb).connect();
}

async function main() {
  const tmpDir = path.join(process.cwd(), 'warehouse', 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const files = (await fs.promises.readdir(tmpDir)).filter(f => f.startsWith('failed_base64_') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')));
  if (files.length === 0) { console.log('No failed frames to process'); return; }
  const pool = await getPool();
  for (const f of files) {
    const full = path.join(tmpDir, f);
    console.log('Processing', f);
    try {
      const buf = await fs.promises.readFile(full);
      const qr = await decodeQrFromBuffer(buf);
      if (!qr) {
        console.log(' - no QR');
        const dest = path.join(tmpDir, 'processed_failed_' + f);
        await fs.promises.rename(full, dest);
        continue;
      }
      console.log(' - decoded:', qr);
      let qrParsed:any = null; try { qrParsed = JSON.parse(qr); } catch {}
      const box_id = qrParsed?.product_id || qr;
      const product_id = qrParsed?.product_id || null;
      const product_name = qrParsed?.product_name || null;
      const category = qrParsed?.category || null;
      const belt_id = 'Belt-1';

      // dedupe within 60s
      let status = 'ok';
      try {
        const dup = await pool.request().input('box_id', sql.VarChar, box_id).query(`SELECT 1 FROM box_scans WHERE box_id = @box_id AND scan_time > DATEADD(SECOND, -60, GETDATE())`);
        status = dup.recordset.length > 0 ? 'duplicate' : 'ok';
      } catch(e) { console.error('dup check failed', e); }

      await pool.request()
        .input('box_id', sql.VarChar, box_id)
        .input('product_id', sql.VarChar, product_id)
        .input('product_name', sql.VarChar, product_name)
        .input('category', sql.VarChar, category)
        .input('belt_id', sql.VarChar, belt_id)
        .input('status', sql.VarChar, status)
        .input('raw_payload', sql.NVarChar(sql.MAX), JSON.stringify({ file: f, qr }))
        .input('ip_address', sql.VarChar, 'server')
        .query(`INSERT INTO box_scans (box_id, product_id, product_name, category, belt_id, status, raw_payload, ip_address) VALUES (@box_id,@product_id,@product_name,@category,@belt_id,@status,@raw_payload,@ip_address)`);

      const dest = path.join(tmpDir, 'processed_success_' + f);
      await fs.promises.rename(full, dest);
    } catch (err) {
      console.error('Error processing', f, err);
      try { await fs.promises.rename(full, path.join(tmpDir, 'processed_failed_' + f)); } catch(_){}
    }
  }
  pool.close();
}

main().catch(e => { console.error(e); process.exit(2); });
