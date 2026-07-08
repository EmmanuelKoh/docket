// app/next/route.ts — GET /next
// Device-facing endpoint. Returns the oldest queued job's ESC/POS bytes
// with X-Job-Id header, or 204 if the queue is empty.
// Ported from api/next.js; the contract and the cost measures are the
// same (see that file and docs/store-costs.md):
//   1. When the Blob queue flag says "empty", respond 204 without touching
//      Redis.
//   2. A safety check queries Redis at most every 60s per server instance
//      regardless, so a stale flag delays a print by at most 60s.

import { OWNER_ID, STORE_DRIVER } from '@/config.js';
import { readQueueSignal, signalsConfigured } from '@/lib/change-signal.js';
import { recordDeviceSeen } from '@/lib/device-presence.js';
import { nextJob } from '@/lib/job-store.js';
import { deviceAuthorized, unauthorized } from '../_lib/device-auth';

export const dynamic = 'force-dynamic';

const SAFETY_CHECK_MS = 60_000;
let lastRealCheckAt = 0; // per warm instance; cold starts always check

export async function GET(req: Request) {
  if (!deviceAuthorized(req)) return unauthorized();

  recordDeviceSeen();

  // The flag only guards the metered store; the json driver (local dev) is
  // free to query directly and never maintains flags.
  if (
    STORE_DRIVER === 'redis' &&
    signalsConfigured() &&
    Date.now() - lastRealCheckAt < SAFETY_CHECK_MS
  ) {
    const hasWork = await readQueueSignal(OWNER_ID);
    if (hasWork === false) {
      return new Response(null, { status: 204 }); // zero Redis commands
    }
    // true or unknown (null): fall through to the real claim.
  }

  lastRealCheckAt = Date.now();
  const job = await nextJob();
  if (!job) {
    return new Response(null, { status: 204 });
  }

  // Content-Length is part of the device contract: the ESP32 firmware
  // reads it via http.getSize() and streams exactly that many bytes to the
  // printer; a chunked response (no length) makes it nack every job. Set it
  // explicitly so the framework never falls back to chunked encoding.
  return new Response(new Uint8Array(job.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(job.bytes.length),
      'X-Job-Id': job.id,
    },
  });
}
