// app/_lib/dashboard-session.ts — the single auth seam for dashboard
// pages and JSON routes: every page/route resolves the Better Auth
// session here. Checks are served from its signed cookie cache, so a
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

export async function sessionValid(): Promise<boolean> {
  return (await getSessionIdentity()) !== null;
}

// For route handlers, which get the web Request directly.
export async function requestSessionIdentity(
  req: Request,
): Promise<SessionIdentity | null> {
  return identityFromHeaders(req.headers);
}

export async function requestSessionValid(req: Request): Promise<boolean> {
  return (await requestSessionIdentity(req)) !== null;
}

// Owner shortcuts: the ownerId that scopes every store call is the
// signed-in user's id.
export async function requestOwner(req: Request): Promise<string | null> {
  const identity = await requestSessionIdentity(req);
  return identity ? identity.userId : null;
}

export async function sessionOwner(): Promise<string | null> {
  const identity = await getSessionIdentity();
  return identity ? identity.userId : null;
}

export function unauthorizedJson(): Response {
  return Response.json({ error: 'sign in required' }, { status: 401 });
}
