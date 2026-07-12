// middleware.ts — optimistic login redirect for dashboard PAGES only.
// Cookie presence, not validity: real enforcement lives in the dashboard
// layout and in every route handler (the seam in
// app/_lib/dashboard-session.ts). Middleware alone is not a security
// boundary (see the 2025 Next.js middleware-bypass CVE); this exists so
// a signed-out visitor gets /login instead of a flash of an empty shell.
//
// JSON/API routes are deliberately NOT matched — they must keep answering
// 401, not a redirect. Device endpoints (/next /ack /nack /tick) and
// /ingest are token-authed and never touch cookies.

import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const authed =
    getSessionCookie(request) || request.cookies.has('docket_session');
  if (!authed) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/history/:path*',
    '/photo/:path*',
    '/printer/:path*',
    '/queue/:path*',
    '/slips/:path*',
    '/studio/:path*',
    '/tape/:path*',
    '/users/:path*',
  ],
};
