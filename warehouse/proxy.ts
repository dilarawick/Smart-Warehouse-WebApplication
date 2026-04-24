import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';

const publicRoutes = [
  '/login',
  '/',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/scan',
  '/api/scans',
  '/warehouse',
  '/warehouse/dashboard',
];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isPublic = publicRoutes.some((route) => pathname.startsWith(route));
  if (isPublic) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const decoded = await verifyToken(token);

  if (!decoded) {
    const clearCookieResponse = NextResponse.next();
    clearCookieResponse.cookies.set('auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};