import { auth } from './lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const protectedPrefixes = ['/admin', '/student', '/teacher', '/parent'];
  const isProtected = protectedPrefixes.some((p) => nextUrl.pathname.startsWith(p));

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl));
  }

  if (nextUrl.pathname === '/login' && isLoggedIn) {
    const role = req.auth?.user?.role || 'student';
    return NextResponse.redirect(new URL(`/${role}`, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/admin/:path*',
    '/student/:path*',
    '/teacher/:path*',
    '/parent/:path*',
    '/login',
  ],
};
