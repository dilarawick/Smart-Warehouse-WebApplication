import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');

    if (!target) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    console.log('[PROXY] Fetching:', target);

    const res = await fetch(target, { cache: 'no-store' });

    if (!res.ok) {
      console.error('[PROXY] Upstream error:', res.status);
      return new NextResponse(`Failed: ${res.status}`, { status: 502 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: any) {
    console.error('[PROXY] Error:', err.message);
    return new NextResponse(`Proxy failed: ${err.message}`, { status: 500 });
  }
}
