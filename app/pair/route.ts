// POST /pair — the device side of the pairing-code flow. Deliberately
// unauthenticated: an unpaired device has no credentials yet. Authority
// comes from physical control — the code only exists printed on the
// device's own paper, and only a signed-in owner can claim it.
//
//   {hardwareId}        -> mint a short-lived code for this hardware id
//                          (the device prints it)
//   {hardwareId, code}  -> poll; 204 while unclaimed, {token} exactly once
//                          after the owner claims the code on /printer
//
// Pairing is a rare, human-present event, so this path may query
// Postgres — the device-cadence rule guards /next and /tick, not this.

import { beginPairing, pollPairing } from '@/lib/devices.js';

const HARDWARE_ID = /^[a-zA-Z0-9:_-]{6,64}$/;

// Tiny per-IP throttle: pairing is seconds-per-decade traffic, so
// anything chatty is abuse. Per warm instance is good enough.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; windowStart: number }>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  h.count++;
  return h.count > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (throttled(ip)) {
    return Response.json({ error: 'slow down' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const hardwareId =
    typeof body?.hardwareId === 'string' ? body.hardwareId : '';
  if (!HARDWARE_ID.test(hardwareId)) {
    return Response.json({ error: 'hardwareId required' }, { status: 400 });
  }

  const code = typeof body?.code === 'string' ? body.code.toUpperCase() : '';
  if (!code) {
    const pairing = await beginPairing(hardwareId);
    return Response.json({ ...pairing, pollSeconds: 5 });
  }

  const result = await pollPairing(hardwareId, code);
  if (!result) return new Response(null, { status: 204 });
  return Response.json(result);
}
