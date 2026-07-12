// app/next/route.ts — GET /next
// Device-facing endpoint. Returns the oldest queued job's ESC/POS bytes
// with X-Job-Id header, or 204 if the queue is empty.
// Ported from api/next.js; the contract and the cost measures are the
// same (see that file and docs/store-costs.md):
//   1. When the Blob queue flag says "empty", respond 204 without touching
//      Redis.
//   2. A safety check queries Redis at most every 60s per server instance
//      regardless, so a stale flag delays a print by at most 60s.

import { STORE_DRIVER } from '@/config.js';
import { readQueueSignal, signalsConfigured } from '@/lib/change-signal.js';
import { recordDeviceSeen } from '@/lib/device-presence.js';
import { nextJob } from '@/lib/job-store.js';
import { deviceAuth, unauthorized } from '../_lib/device-auth';

export const dynamic = 'force-dynamic';

const SAFETY_CHECK_MS = 60_000;
const lastRealCheckAt = new Map<string, number>(); // per owner per warm instance

export async function GET(req: Request) {
  const dev = await deviceAuth(req);
  if (!dev) return unauthorized();

  // One heartbeat per device, written to the primary owner's slot; every
  // member's Printer page reads that slot for the online dot.
  recordDeviceSeen(dev.ownerId);

  // Serve each owner the device prints for, in stable order. The flag only
  // guards the metered store; the json driver (local dev) is free to query
  // directly and never maintains flags.
  for (const owner of dev.owners) {
    if (
      STORE_DRIVER === 'redis' &&
      signalsConfigured() &&
      Date.now() - (lastRealCheckAt.get(owner) || 0) < SAFETY_CHECK_MS
    ) {
      const hasWork = await readQueueSignal(owner);
      if (hasWork === false) continue; // zero Redis commands for this owner
      // true or unknown (null): fall through to the real claim.
    }

    lastRealCheckAt.set(owner, Date.now());
    const job = await nextJob(owner);
    if (!job) continue;

    // Content-Length is part of the device contract: the ESP32 firmware
    // reads it via http.getSize() and streams exactly that many bytes to
    // the printer; a chunked response (no length) makes it nack every job.
    // The job id is owner-qualified (owner~id) because members' ids can
    // collide; the firmware echoes it opaquely.
    return new Response(new Uint8Array(job.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(job.bytes.length),
        'X-Job-Id': `${owner}~${job.id}`,
      },
    });
  }
  return new Response(null, { status: 204 });
}
