import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Jimp from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const arg = process.argv[2];
  const def = path.join(__dirname, '../tmp/mqtt_payload_image_1777015708559.jpg');
  const filePath = arg || def;
  console.log('jsQR decode file:', filePath);
  try {
    const jsqrMod = await import('jsqr').catch(() => null);
    if (!jsqrMod) {
      console.error('jsQR not installed. Run `npm install jsqr` in warehouse');
      process.exit(3);
    }
    const jsQR = (jsqrMod as any).default || jsqrMod;
    const buf = await fs.promises.readFile(filePath);
    const img = await Jimp.read(buf);
    const { width, height, data } = img.bitmap;
    console.log('image size', width, 'x', height, 'pixels');
    // convert to grayscale Uint8ClampedArray
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]) & 0xFF;
    }

    let res: any = null;
    try {
      res = jsQR(gray, width, height);
    } catch (e) {
      console.warn('jsQR initial attempt failed, trying alternative greyscale source:', String(e));
      // Try forcing Jimp greyscale then using the red channel
      img.greyscale();
      const { data: d2 } = img.bitmap;
      const gray2 = new Uint8ClampedArray(width * height);
      for (let i = 0, j = 0; i < d2.length; i += 4, j++) {
        gray2[j] = d2[i];
      }
      try {
        res = jsQR(gray2, width, height);
      } catch (e2) {
        console.error('jsQR retry failed:', String(e2));
        throw e2;
      }
    }
    if (res) {
      console.log('jsQR decoded:', res.data);
      console.log('location:', res.location);
      process.exit(0);
    } else {
      console.log('jsQR: no QR found');
      process.exit(0);
    }
  } catch (err) {
    console.error('Error running jsQR decode:', err);
    process.exit(2);
  }
}

main();
