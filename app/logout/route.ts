// GET /logout — clears BOTH doors: the Better Auth session (revoked
// server-side, its cookies cleared) and the legacy HMAC cookie, then
// returns to /login. Same contract as the legacy dashboard's /logout.

import { getAuth } from '@/lib/auth-server.js';
import { clearSessionCookie } from '@/lib/session.js';

export async function GET(req: Request) {
  const headers = new Headers({ Location: '/login' });

  try {
    const auth = await getAuth();
    const res = await auth.api.signOut({
      headers: req.headers,
      asResponse: true,
    });
    for (const cookie of res.headers.getSetCookie()) {
      headers.append('Set-Cookie', cookie);
    }
  } catch {
    // No Better Auth session to revoke — fine, still clear the legacy one.
  }

  headers.append('Set-Cookie', clearSessionCookie());
  return new Response(null, { status: 302, headers });
}
