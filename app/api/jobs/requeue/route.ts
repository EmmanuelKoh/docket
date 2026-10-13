// POST /api/jobs/requeue?job=ID — move an inflight job back to queued.
// The dashboard equivalent of the device's /nack: a print that was claimed
// but never acked (a printer that died mid-job, or was offline) sits
// inflight until a device polls /next to expire its lease. This lets the
// dashboard clear a stuck claim directly — the job returns to queued, from
// where it prints again or can be canceled.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { queueData } from '@/app/_lib/queue-data';
import { jobsRequeue } from '@/lib/ops/jobs.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job') ?? '';
  return json(async () => {
    await jobsRequeue(caller, { id });
    return queueData(caller);
  });
}
