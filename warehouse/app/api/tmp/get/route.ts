import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  // sanitize: disallow ../
  if (name.includes('..') || path.isAbsolute(name)) return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  try {
    const filePath = path.join(process.cwd(), 'warehouse', 'tmp', name);
    const buf = await fs.promises.readFile(filePath);
    const ext = path.extname(name).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const b64 = buf.toString('base64');
    return NextResponse.json({ name, data: `data:${mime};base64,${b64}` });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}
