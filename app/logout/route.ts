// GET /logout — revokes the Better Auth session server-side, clears its
// cookies, and returns to /login.

import { getAuth } from '@/lib/auth-server.js';

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
    // No session to revoke — still land on /login.
  }

  return new Response(null, { status: 302, headers });
}
