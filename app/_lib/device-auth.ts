// app/_lib/device-auth.ts — device auth for the Next.js route handlers.
// Device-facing endpoints accept Authorization: Bearer <token> and nothing
// else — never the dashboard cookie, because the ESP32 can't log in.
//
// The token becomes a device Caller in lib/ops/identity.js: a per-device
// token minted at pairing (lib/devices.js), or the local-dev DEVICE_TOKEN
// for the laptop agents (no default in production builds or on Vercel).

import { callerForDeviceToken } from '@/lib/ops/identity.js';

// null = missing or unknown token (401). A store failure throws (500), and
// so does a lookup over the unknown-token budget (OpError 'busy', 503):
// never 401.
export async function deviceCaller(req: Request) {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token ? callerForDeviceToken(token) : null;
}

// Device routes only. Never 401 here: ten 401s in a row wipe the printer's
// token (firmware/docket-agent/docket-agent.ino:210-217) and force a
// physical re-pair. Too many unknown-token lookups on this instance
// ('busy', lib/ops/identity.js) answer 503 with Retry-After; the firmware
// backs off and polls again, and its 401 count resets.
const DEVICE_STATUS: Record<string, number> = {
  invalid: 400,
  forbidden: 403,
  busy: 503,
};
export function deviceErrorResponse(err: unknown): Response {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    retryAfter?: number;
  };
  const status =
    (e?.name === 'OpError' && e.code && DEVICE_STATUS[e.code]) || 500;
  if (status === 500) console.error(err);
  return Response.json(
    { error: status === 500 ? 'server error' : e.message },
    {
      status,
      headers:
        status === 503 ? { 'Retry-After': String(e.retryAfter ?? 60) } : {},
    },
  );
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'missing or invalid device token' },
    { status: 401 },
  );
}
