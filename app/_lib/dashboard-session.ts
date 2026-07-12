// app/_lib/dashboard-session.ts — the single auth seam for dashboard
// pages and JSON routes. Two doors are honored during the accounts
// transition:
//   1. a Better Auth session (real identity: userId + role), checked
//      first — served from its signed cookie cache, so no DB read on
//      normal page loads;
//   2. the legacy stateless HMAC cookie (lib/session.js), which carries
//      no identity — it belongs to the single pre-accounts owner, so it
//      resolves to OWNER_ID. Deleted in the last phase of the accounts
//      build, along with the password door that sets it.
// Device endpoints never use this — they keep Bearer token auth.

import { headers } from 'next/headers';
import { OWNER_ID } from '@/config.js';
import { getAuth } from '@/lib/auth-server.js';
import { hasValidSession } from '@/lib/session.js';

export type SessionIdentity = {
  userId: string;
  role: string;
  legacy: boolean;
};

async function identityFromHeaders(
  h: Headers,
): Promise<SessionIdentity | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: h }).catch(() => null);
  if (s?.user) {
    const role = (s.user as { role?: string | null }).role || 'user';
    return { userId: s.user.id, role, legacy: false };
  }
  if (hasValidSession({ headers: { cookie: h.get('cookie') || '' } })) {
    // The legacy cookie predates identity: it can only be the original
    // single owner. Role admin: that owner administers the deployment.
    return { userId: OWNER_ID, role: 'admin', legacy: true };
  }
  return null;
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

// Owner shortcuts: the ownerId that scopes every store call. For account
// sessions it IS the user id; the legacy cookie resolves to OWNER_ID.
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
