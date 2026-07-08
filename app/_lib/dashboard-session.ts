// app/_lib/dashboard-session.ts — session-cookie checks for the Next.js
// dashboard, delegating to lib/session.js (the same stateless HMAC cookie
// the legacy dashboard sets, so a login carries across both apps).
// Device endpoints never use this — they keep Bearer DEVICE_TOKEN auth.

import { cookies } from 'next/headers';
import { hasValidSession } from '@/lib/session.js';

// For server components (pages/layouts).
export async function sessionValid(): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return hasValidSession({ headers: { cookie } });
}

// For route handlers, which get the web Request directly.
export function requestSessionValid(req: Request): boolean {
  return hasValidSession({
    headers: { cookie: req.headers.get('cookie') || '' },
  });
}

export function unauthorizedJson(): Response {
  return Response.json({ error: 'sign in required' }, { status: 401 });
}
