// GET /api/jobs/detail?job=ID — the expanded-row debug record: template
// source and input data, both clipped (lib/ops/jobs.js).

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { jobsDetail } from '@/lib/ops/jobs.js';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job') ?? '';
  return json(() => jobsDetail(caller, { id }));
}
