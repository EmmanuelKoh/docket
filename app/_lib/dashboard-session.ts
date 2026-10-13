// app/_lib/dashboard-session.ts — the single auth seam for dashboard
// pages and JSON routes: every page/route resolves the Better Auth
// session here, through getCaller/requestCaller (app/_lib/caller.ts).
// Checks are served from its signed cookie cache, so a
// normal page view costs zero database reads. Device endpoints never use
// this — they keep Bearer token auth (app/_lib/device-auth.ts).

import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth-server.js';

export type SessionIdentity = {
  userId: string;
  role: string;
};

async function identityFromHeaders(
  h: Headers,
): Promise<SessionIdentity | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: h }).catch(() => null);
  if (!s?.user) return null;
  const role = (s.user as { role?: string | null }).role || 'user';
  return { userId: s.user.id, role };
}

// For server components (pages/layouts).
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  return identityFromHeaders(await headers());
}

// For route handlers, which get the web Request directly.
export async function requestSessionIdentity(
  req: Request,
): Promise<SessionIdentity | null> {
  return identityFromHeaders(req.headers);
}
