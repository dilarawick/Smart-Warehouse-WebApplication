import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, belt_id, esp_ip } = body;
    
    console.log('[DECODE API] Request:', id, belt_id, esp_ip);
    
    return NextResponse.json({ success: true, received: true });
  } catch (err) {
    console.error('[DECODE API] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}