import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Jimp from 'jimp';
import { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const zxingReader = new MultiFormatReader();

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
  } catch (_) {
    return null;
  }
}

async function decodeQrFromBuffer(buffer: Buffer): Promise<string | null> {
  const baseImage = await Jimp.read(buffer);
  const originalWidth = baseImage.bitmap.width;
  const originalHeight = baseImage.bitmap.height;

  let work = baseImage;
  if (originalWidth < 640 || originalHeight < 480) {
    const scale = Math.max(640 / originalWidth, 480 / originalHeight);
    work = baseImage.clone().resize(
      Math.round(originalWidth * scale),
      Math.round(originalHeight * scale),
      Jimp.RESIZE_NEAREST_NEIGHBOR
    );
  }

  // ensure tmp dir
  await fs.promises.mkdir(path.join(__dirname, '../tmp'), { recursive: true });
  await work.clone().writeAsync(path.join(__dirname, '../tmp/variant_original.jpg'));

  // Strategy 1: original
  let qr = await decodeWithZxing(work);
  if (qr) return qr;

  // Strategy 2: high contrast
  const img2 = work.clone();
  img2.contrast(1.0).brightness(0.05);
  await img2.clone().writeAsync(path.join(__dirname, '../tmp/variant_contrast.jpg'));
  qr = await decodeWithZxing(img2);
  if (qr) return qr;

  // Strategy 3: inverted
  const img3 = work.clone().invert();
  img3.contrast(1.0);
  await img3.clone().writeAsync(path.join(__dirname, '../tmp/variant_inverted.jpg'));
  qr = await decodeWithZxing(img3);
  if (qr) return qr;

  // Strategy 4: greyscale
  const img4 = work.clone().greyscale();
  img4.contrast(0.8);
  await img4.clone().writeAsync(path.join(__dirname, '../tmp/variant_greyscale.jpg'));
  qr = await decodeWithZxing(img4);
  if (qr) return qr;

  // Strategy 5: center-crop + sharpen + greyscale
  try {
    const w = work.bitmap.width;
    const h = work.bitmap.height;
    const size = Math.round(Math.min(w, h) * 0.8);
    const x = Math.max(0, Math.round((w - size) / 2));
    const y = Math.max(0, Math.round((h - size) / 2));
    const cropped = work.clone().crop(x, y, size, size);
    await cropped.clone().writeAsync(path.join(__dirname, '../tmp/variant_cropped.jpg'));
    try {
      const sharpenKernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      // @ts-ignore
      cropped.convolute && cropped.convolute(sharpenKernel, 3, 3);
      await cropped.clone().writeAsync(path.join(__dirname, '../tmp/variant_cropped_sharp.jpg'));
    } catch (_) {}
    let q = await decodeWithZxing(cropped);
    if (q) return q;
    const cg = cropped.clone().greyscale().contrast(0.8);
    await cg.clone().writeAsync(path.join(__dirname, '../tmp/variant_cropped_grey.jpg'));
    q = await decodeWithZxing(cg);
    if (q) return q;
  } catch (_) {}

  // Strategy 6: try rotations
  for (const deg of [90, 180, 270]) {
    const r = work.clone().rotate(deg, false);
    await r.clone().writeAsync(path.join(__dirname, `../tmp/variant_rot_${deg}.jpg`));
    qr = await decodeWithZxing(r);
    if (qr) return qr;
  }

  // Strategy 7: aggressive upscale + normalize + posterize + threshold
  try {
    const maxSide = 1600;
    const scale = Math.max(1, maxSide / Math.max(work.bitmap.width, work.bitmap.height));
    const up = work.clone().resize(Math.round(work.bitmap.width * scale), Math.round(work.bitmap.height * scale), Jimp.RESIZE_BICUBIC);
    up.normalize();
    up.posterize(2);
    await up.clone().writeAsync(path.join(__dirname, '../tmp/variant_upscaled.jpg'));
    for (const t of [64, 96, 128, 160]) {
      try {
        // @ts-ignore
        const th = up.clone();
        th.threshold && th.threshold({ max: t });
        await th.clone().writeAsync(path.join(__dirname, `../tmp/variant_thresh_${t}.jpg`));
        const q = await decodeWithZxing(th);
        if (q) return q;
      } catch (_) {}
    }
  } catch (_) {}

  return null;
}

async function main() {
  const arg = process.argv[2];
  const def = path.join(__dirname, '../tmp/mqtt_payload_image_1777015165532.jpg');
  const filePath = arg || def;
  console.log('Decoding file:', filePath);
  try {
    const buf = await fs.promises.readFile(filePath);
    const qr = await decodeQrFromBuffer(buf as Buffer);
    if (!qr) {
      console.log('No QR decoded');
      process.exit(0);
    }
    console.log('Decoded QR:', qr);
  } catch (err) {
    console.error('Error decoding file:', err);
    process.exit(2);
  }
}

main();
