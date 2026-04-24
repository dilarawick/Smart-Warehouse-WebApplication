import { NextResponse } from 'next/server';
import Jimp from 'jimp';
import { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';

const zxingReader = new MultiFormatReader();

function extractImageBuffer(body: any): Buffer | null {
  if (body.image_base64 || body.frame_base64 || body.image) {
    const raw = body.image_base64 || body.frame_base64 || body.image;
    const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
    return Buffer.from(base64, 'base64');
  }
  return null;
}

function extractLuminanceArray(image: Jimp): Uint8ClampedArray {
  const { data, width, height } = image.bitmap;
  const luminanceArray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luminanceArray[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) & 0xFF;
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
  } catch (err) {
    return null;
  }
}

async function decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
  const baseImage = await Jimp.read(buffer);
  const originalWidth = baseImage.bitmap.width;
  const originalHeight = baseImage.bitmap.height;

  // Resize if too small
  let work = baseImage;
  if (originalWidth < 640 || originalHeight < 480) {
    const scale = Math.max(640 / originalWidth, 480 / originalHeight);
    work = baseImage.clone().resize(
      Math.round(originalWidth * scale),
      Math.round(originalHeight * scale),
      Jimp.RESIZE_NEAREST_NEIGHBOR
    );
  }

  // Strategy 1: Original
  let qr = await decodeWithZxing(work);
  if (qr) return qr;

  // Strategy 2: High contrast
  const img2 = work.clone();
  img2.contrast(1.0).brightness(0.05);
  qr = await decodeWithZxing(img2);
  if (qr) return qr;

  // Strategy 3: Inverted
  const img3 = work.clone().invert();
  img3.contrast(1.0);
  qr = await decodeWithZxing(img3);
  if (qr) return qr;

  // Strategy 4: Greyscale high contrast
  const img4 = work.clone().greyscale();
  img4.contrast(0.8);
  qr = await decodeWithZxing(img4);
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

    console.log('[DECODE API] QR decoded:', qrData.substring(0, 100));
    return NextResponse.json({ success: true, qr_data: qrData });
  } catch (err) {
    console.error('[DECODE API] Error:', err);
    return NextResponse.json({ error: String(err), success: false }, { status: 200 });
  }
}
