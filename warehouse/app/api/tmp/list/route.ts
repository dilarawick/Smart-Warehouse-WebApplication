import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const tmpDir = path.join(process.cwd(), 'warehouse', 'tmp');
    const files = await fs.promises.readdir(tmpDir);
    const items = await Promise.all(files.map(async (f) => {
      try {
        const s = await fs.promises.stat(path.join(tmpDir, f));
        return { name: f, size: s.size, mtime: s.mtime.toISOString() };
      } catch (_) { return null; }
    }));
    return NextResponse.json(items.filter(Boolean));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
