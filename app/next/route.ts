// app/next/route.ts — GET /next
// Device-facing endpoint. Returns the oldest queued job's ESC/POS bytes
// with an X-Job-Id header, or 204 if the queue is empty. The queue walk
// and its cost measures live in lib/ops/device-service.js#serveNext.

import { serveNext } from '@/lib/ops/device-service.js';
import {
  deviceCaller,
  deviceErrorResponse,
  unauthorized,
} from '../_lib/device-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const caller = await deviceCaller(req);
    if (!caller) return unauthorized();
    const job = await serveNext(caller);
    if (!job) return new Response(null, { status: 204 });
    // Content-Length is part of the device contract: the ESP32 firmware
    // reads it via http.getSize() and streams exactly that many bytes to
    // the printer; a chunked response (no length) makes it nack every job.
    return new Response(new Uint8Array(job.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(job.bytes.length),
        'X-Job-Id': job.jobRef,
      },
    });
  } catch (err) {
    return deviceErrorResponse(err); // 400/403/500, never 401
  }
}
