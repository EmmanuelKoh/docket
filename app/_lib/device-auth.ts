// app/_lib/device-auth.ts — device auth for the Next.js route handlers.
// Device-facing endpoints accept Authorization: Bearer <token> and nothing
// else — never the dashboard cookie, because the ESP32 can't log in.
//
// Two token kinds during the pairing transition:
//   - a per-device token minted at pairing (lib/devices.js) — resolves to
//     that device's owner; verification is memory-cache/Redis-mirror fast
//   - the legacy shared DEVICE_TOKEN env — resolves to the OWNER_ID owner
//     (compared constant-time; removed once every device is paired)

import crypto from 'node:crypto';
import { DEVICE_TOKEN, OWNER_ID } from '@/config.js';
import { resolveDeviceToken } from '@/lib/devices.js';

export type DeviceIdentity = { ownerId: string; deviceId: string };

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function deviceAuth(req: Request): Promise<DeviceIdentity | null> {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  if (!token) return null;

  if (DEVICE_TOKEN && constantTimeEqual(token, DEVICE_TOKEN)) {
    return { ownerId: OWNER_ID, deviceId: 'legacy' };
  }
  return resolveDeviceToken(token);
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'missing or invalid device token' },
    { status: 401 },
  );
}
