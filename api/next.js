// api/next.js — GET /next
// Device-facing endpoint. Returns the oldest queued job's ESC/POS bytes
// with X-Job-Id header, or 204 if the queue is empty.
// Requires Authorization: Bearer <DEVICE_TOKEN>.
//
// This is the hottest path in the system (the device polls every POLL_MS)
// and Upstash bills per command — see docs/store-costs.md before adding
// any store call here. Two measures keep its idle Redis cost at zero:
//   1. The queue flag (lib/change-signal.js, stored in Blob — reads are 5x
//      cheaper than Redis commands): when it says "empty", respond 204
//      without touching Redis.
//   2. A safety check: at most every 60s per server instance, query Redis
//      regardless. A stale or lost flag delays a print by at most 60s and
//      can never lose one.
// The device's "last seen" write is throttled to once per 60s.

import { nextJob } from '../lib/job-store.js';
import { requireDeviceToken } from '../lib/auth.js';
import { recordDeviceSeen } from '../lib/device-presence.js';
import { readQueueSignal, signalsConfigured } from '../lib/change-signal.js';
import { OWNER_ID, STORE_DRIVER } from '../config.js';

const SAFETY_CHECK_MS = 60_000;
let lastRealCheckAt = 0; // per warm instance; cold starts always check

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }
  if (!requireDeviceToken(req, res)) return;

  recordDeviceSeen();

  // The flag only guards the metered store; the json driver (local dev) is
  // free to query directly and never maintains flags.
  if (STORE_DRIVER === 'redis' && signalsConfigured()
      && Date.now() - lastRealCheckAt < SAFETY_CHECK_MS) {
    const hasWork = await readQueueSignal(OWNER_ID);
    if (hasWork === false) {
      return res.status(204).send(); // zero Redis commands
    }
    // true or unknown (null): fall through to the real claim.
  }

  lastRealCheckAt = Date.now();
  const job = await nextJob();
  if (!job) {
    return res.status(204).send();
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Job-Id', job.id);
  return res.status(200).send(job.bytes);
}
