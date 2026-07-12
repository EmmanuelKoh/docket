// app/nack/route.ts — POST /nack?job=ID
// Device-facing endpoint. Requeues a job after a failed print attempt.
// Ported from api/nack.js.

import { nackJob } from '@/lib/job-store.js';
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
  const found = await nackJob(ref.owner, ref.id);
  return Response.json({ requeued: id, found });
}
