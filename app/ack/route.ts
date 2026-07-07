// app/ack/route.ts — POST /ack?job=ID
// Device-facing endpoint. Marks a job as done after successful print.
// Ported from api/ack.js.

import { ackJob } from '@/lib/job-store.js';
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

  const found = await ackJob(id);
  return Response.json({ acked: id, found });
}
