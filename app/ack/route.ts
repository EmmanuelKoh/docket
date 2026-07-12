// app/ack/route.ts — POST /ack?job=ID
// Device-facing endpoint. Marks a job as done after successful print.
// Ported from api/ack.js.

import { ackJob } from '@/lib/job-store.js';
import { deviceAuth, parseJobRef, unauthorized } from '../_lib/device-auth';

export async function POST(req: Request) {
  const dev = await deviceAuth(req);
  if (!dev) return unauthorized();

  const id = new URL(req.url).searchParams.get('job');
  if (!id) {
    return Response.json(
      { error: 'job query parameter is required' },
      { status: 400 },
    );
  }

  const ref = parseJobRef(dev, id);
  if (!ref) {
    return Response.json({ error: 'job not on this device' }, { status: 403 });
  }
  const found = await ackJob(ref.owner, ref.id);
  return Response.json({ acked: id, found });
}
