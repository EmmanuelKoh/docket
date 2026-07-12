// app/_lib/device-auth.ts — device auth for the Next.js route handlers.
// Device-facing endpoints accept Authorization: Bearer <token> and nothing
// else — never the dashboard cookie, because the ESP32 can't log in.
//
// Two token kinds:
//   - a per-device token minted at pairing (lib/devices.js) — resolves to
//     that device's owner; verification is memory-cache/Redis-mirror fast
//   - the local-dev DEVICE_TOKEN env for the laptop agents — resolves to
//     the OWNER_ID owner (compared constant-time; has no default hosted,
//     so the door does not exist in production unless the env is set)

import crypto from 'node:crypto';
import { DEVICE_TOKEN, OWNER_ID } from '@/config.js';
import { resolveDeviceToken } from '@/lib/devices.js';

// owners = every account this device prints and ticks for:
// [primary owner, ...members]. Single-owner devices have one entry.
export type DeviceIdentity = {
  ownerId: string;
  deviceId: string;
  owners: string[];
};

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
    return { ownerId: OWNER_ID, deviceId: 'legacy', owners: [OWNER_ID] };
  }
  return resolveDeviceToken(token);
}

// Parse a job reference off the wire. Qualified form "owner~job-N" (what
// /next hands out); the owner must be one the device serves. A bare id is
// the pre-sharing form and maps to the primary owner.
export function parseJobRef(
  dev: DeviceIdentity,
  raw: string,
): { owner: string; id: string } | null {
  const sep = raw.indexOf('~');
  if (sep < 0) return { owner: dev.owners[0], id: raw };
  const owner = raw.slice(0, sep);
  if (!dev.owners.includes(owner)) return null;
  return { owner, id: raw.slice(sep + 1) };
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'missing or invalid device token' },
    { status: 401 },
  );
}
