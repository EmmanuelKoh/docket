// app/_lib/device-auth.ts — device token check for the Next.js route
// handlers. Same rule as lib/auth.js (which serves the legacy api/*.js
// functions and expects Express-style req/res): device-facing endpoints
// accept Authorization: Bearer <DEVICE_TOKEN> and nothing else — never the
// dashboard cookie, because the ESP32 can't log in.

import { DEVICE_TOKEN } from '@/config.js';

export function deviceAuthorized(req: Request): boolean {
  return req.headers.get('authorization') === `Bearer ${DEVICE_TOKEN}`;
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'missing or invalid device token' },
    { status: 401 },
  );
}
