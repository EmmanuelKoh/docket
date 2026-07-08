// GET /logout — clears the session cookie and returns to /login,
// same contract as the legacy dashboard's /logout.

import { clearSessionCookie } from '@/lib/session.js';

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: '/login', 'Set-Cookie': clearSessionCookie() },
  });
}
