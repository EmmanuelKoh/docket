// lib/device-presence.js — throttled "printer is online" bookkeeping.
//
// The device contacts the server constantly (/next every 3s, /tick every
// 30s). Writing lastSeenAt to the store on every contact was ~30K Redis
// commands a day for a value the dashboard only checks against a 90-second
// staleness rule. Write it at most once per 60s instead: the dashboard's
// online indicator stays correct, at ~1.5K writes a day.
//
// The throttle is per warm server instance and per owner (module state).
// Cold starts write immediately, which only makes the value fresher.

import { setState } from './state-store.js';

const WRITE_EVERY_MS = 60_000;
const lastWriteAt = new Map();

export function recordDeviceSeen(ownerId) {
  const now = Date.now();
  if (now - (lastWriteAt.get(ownerId) || 0) < WRITE_EVERY_MS) return;
  lastWriteAt.set(ownerId, now);
  setState(ownerId, 'device', { lastSeenAt: new Date().toISOString() }).catch(() => {});
}
