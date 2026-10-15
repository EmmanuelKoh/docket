// POST /api/jobs/cancel?job=ID — cancel a QUEUED job (inflight can't be
// canceled: the printer may already be receiving it — jobs.cancel enforces
// this). Returns fresh queue data so the client repaints in one round trip.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { queueData } from '@/app/_lib/queue-data';
import { requestTimeZone } from '@/app/_lib/time';
import { jobsCancel } from '@/lib/ops/jobs.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job') ?? '';
  return json(async () => {
    await jobsCancel(caller, { id });
    return queueData(caller, requestTimeZone(req));
  });
}
