// /api/auth/* — every Better Auth endpoint (sign-in, sign-up, sign-out,
// get-session, admin, ...) mounts through this catch-all. Hand-rolled
// instead of toNextJsHandler because our auth instance is built lazily
// (getAuth awaits the db); toNextJsHandler wants it at module init.

import { getAuth } from '@/lib/auth-server.js';

async function handle(req: Request) {
  const auth = await getAuth();
  return auth.handler(req);
}

export { handle as GET, handle as POST };
