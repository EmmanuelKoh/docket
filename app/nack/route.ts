// app/nack/route.ts — POST /nack?job=ID
// Device-facing endpoint. Requeues a job after a failed print attempt.
// Ported from api/nack.js.

import { nackJob } from '@/lib/job-store.js';
import { deviceAuthorized, unauthorized } from '../_lib/device-auth';

export async function POST(req: Request) {
  if (!deviceAuthorized(req)) return unauthorized();

  const id = new URL(req.url).searchParams.get('job');
  if (!id) {
    return Response.json(
      { error: 'job query parameter is required' },
      { status: 400 },
    );
  }

  const found = await nackJob(id);
  return Response.json({ requeued: id, found });
}
