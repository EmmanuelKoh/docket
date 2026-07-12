// POST /api/jobs/requeue?job=ID — move an inflight job back to queued.
// The dashboard equivalent of the device's /nack: a print that was claimed
// but never acked (a printer that died mid-job, or was offline) sits
// inflight until a device polls /next to expire its lease. This lets the
// dashboard clear a stuck claim directly — the job returns to queued, from
// where it prints again or can be canceled.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { queueData } from '@/app/_lib/queue-data';
import { nackJob } from '@/lib/job-store.js';

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  if (id) await nackJob(owner, id);
  return Response.json(await queueData(owner));
}
