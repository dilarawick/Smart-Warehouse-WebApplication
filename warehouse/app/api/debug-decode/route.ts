/**
 * POST /api/debug-decode
 * Diagnostic endpoint: accepts the same body as /api/decode and returns
 * per-strategy results + image metadata so you can see exactly what is
 * happening without needing server log access.
 *
 * REMOVE or PROTECT this endpoint before going to production.
 */
import { NextResponse } from 'next/server';
import Jimp from 'jimp';
import jsQR from 'jsqr';

function tryDecodeQR(image: Jimp): string | null {
  const { data, width, height } = image.bitmap;
  const rgba = new Uint8ClampedArray(Buffer.from(data));

  let r = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  if (r?.data) return r.data;

  r = jsQR(rgba, width, height, { inversionAttempts: 'onlyInvert' });
  if (r?.data) return r.data;

  return null;
}

type StrategyResult = { strategy: string; width: number; height: number; found: boolean; data?: string };

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let buffer: Buffer | null = null;

    if (body.image_base64 || body.frame_base64 || body.image) {
      const raw = body.image_base64 || body.frame_base64 || body.image;
      const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
      buffer = Buffer.from(b64, 'base64');
    } else if (body.frame_url) {
      const res = await fetch(body.frame_url, { cache: 'no-store' });
      if (!res.ok) return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 400 });
      buffer = Buffer.from(await res.arrayBuffer());
    }

    if (!buffer) return NextResponse.json({ error: 'No image data provided' }, { status: 400 });

    let baseImage: Jimp;
    try {
      baseImage = await Jimp.read(buffer);
    } catch (e) {
      return NextResponse.json({ error: `Jimp.read failed: ${e}` }, { status: 400 });
    }

    const origW = baseImage.bitmap.width;
    const origH = baseImage.bitmap.height;
    const results: StrategyResult[] = [];

    const test = (img: Jimp, label: string) => {
      const found = tryDecodeQR(img);
      results.push({ strategy: label, width: img.bitmap.width, height: img.bitmap.height, found: !!found, ...(found ? { data: found } : {}) });
      return found;
    };

    let work = baseImage;
    if (origW < 400 || origH < 300) {
      const scale = Math.max(400 / origW, 300 / origH);
      work = baseImage.clone().resize(Math.round(origW * scale), Math.round(origH * scale), Jimp.RESIZE_BICUBIC);
    }

    const grey = work.clone().greyscale();

    const strategies: [Jimp, string][] = [
      [work.clone(), 'raw'],
      [grey.clone(), 'grey'],
      [grey.clone().contrast(0.8), 'grey+c0.8'],
      [grey.clone().contrast(1.0), 'grey+c1.0'],
      [grey.clone().brightness(0.2).contrast(0.6), 'grey+bright+c0.6'],
      [grey.clone().brightness(-0.2).contrast(0.8), 'grey+dark+c0.8'],
      [grey.clone().convolute([[0,-1,0],[-1,5,-1],[0,-1,0]]).contrast(0.8), 'grey+sharpen+c0.8'],
      [work.clone().scale(2, Jimp.RESIZE_BICUBIC).greyscale().contrast(0.8), '2x+grey+c0.8'],
      [work.clone().scale(3, Jimp.RESIZE_BICUBIC).greyscale().contrast(1.0), '3x+grey+c1.0'],
    ];

    let winner: string | null = null;
    for (const [img, label] of strategies) {
      const found = test(img, label);
      if (found && !winner) winner = found;
    }

    return NextResponse.json({
      bufferBytes: buffer.length,
      originalDimensions: { width: origW, height: origH },
      workingDimensions: { width: work.bitmap.width, height: work.bitmap.height },
      decodedQR: winner,
      strategies: results,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
