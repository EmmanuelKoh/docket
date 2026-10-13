// lib/device-presence.js — throttled "printer is online" bookkeeping.
//
// The device contacts the server constantly (/next every 5s, /tick every
// 30s). Writing lastSeenAt to the store on every contact would be ~20K Redis
// commands a day for a value the dashboard only checks against a 90-second
// staleness rule. Write it at most once per 60s instead: the dashboard's
// online indicator stays correct, at ~1.5K writes a day.
//
// The throttle is per warm server instance and per owner (module state).
// Cold starts write immediately, which only makes the value fresher.

import { listDevices } from './devices.js';
import { getState, setState } from './state-store.js';

const WRITE_EVERY_MS = 60_000;
const lastWriteAt = new Map();

export function recordDeviceSeen(ownerId) {
  const now = Date.now();
  if (now - (lastWriteAt.get(ownerId) || 0) < WRITE_EVERY_MS) return;
  lastWriteAt.set(ownerId, now);
  setState(ownerId, 'device', { lastSeenAt: new Date().toISOString() }).catch(() => {});
}

// Seen within 90s = online: the write above lands at most once per 60s,
// so 90s leaves a 30s margin.
const ONLINE_MS = 90_000;

// The read side, for the dashboard (printers.status). A device's one
// heartbeat lands on its primary owner's slot, which for a member is
// someone else's: read the slot of the printer this owner prints to,
// their own first, else the first one shared with them (listDevices
// order). No device: the owner's own slot. A caller that already listed
// the owner's devices passes those rows, saving the second listing.
/**
 * @param {string} ownerId
 * @param {Array<{ primaryOwnerId: string }>} [devices] listDevices(ownerId), if already read
 * @returns {Promise<{ lastSeenAt: string | null, online: boolean }>}
 */
export async function printerPresence(ownerId, devices) {
  const [first] = devices ?? (await listDevices(ownerId));
  const seen = await getState(first?.primaryOwnerId ?? ownerId, 'device');
  const lastSeenAt = typeof seen?.lastSeenAt === 'string' ? seen.lastSeenAt : null;
  return { lastSeenAt, online: !!lastSeenAt && Date.now() - Date.parse(lastSeenAt) <= ONLINE_MS };
}
