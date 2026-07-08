// POST /api/jobs/cancel?job=ID — cancel a QUEUED job (inflight can't be
// canceled: the printer may already be receiving it — cancelJob enforces
// this). Returns fresh queue data so the client repaints in one round trip.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { queueData } from '@/app/_lib/queue-data';
import { cancelJob } from '@/lib/job-store.js';

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  if (id) await cancelJob(id);
  return Response.json(await queueData());
}
