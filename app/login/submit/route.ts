// POST /login/submit — checks the password and sets the session cookie.
// Ported from the /login branch of api/dashboard.js; the cookie comes from
// lib/session.js unchanged, so it is interchangeable with the legacy app's.

import crypto from 'node:crypto';
import { DASHBOARD_PASSWORD } from '@/config.js';
import { createSessionCookie } from '@/lib/session.js';

function passwordMatches(given: unknown): boolean {
  if (!DASHBOARD_PASSWORD || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(DASHBOARD_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (form && passwordMatches(form.get('password'))) {
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': createSessionCookie() },
    });
  }
  const error = DASHBOARD_PASSWORD
    ? 'wrong password'
    : 'DASHBOARD_PASSWORD is not set';
  return new Response(null, {
    status: 303,
    headers: { Location: `/login?error=${encodeURIComponent(error)}` },
  });
}
