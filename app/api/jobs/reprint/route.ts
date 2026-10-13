// POST /api/jobs/reprint?job=ID — re-render from the stored template+data
// and queue a fresh job (lib/ops/jobs.js). Raw jobs (Tape) answer 400.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { jobsReprint } from '@/lib/ops/jobs.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req); // null -> the op answers 401 'sign in required'
  const id = new URL(req.url).searchParams.get('job') ?? '';
  return json(() => jobsReprint(caller, { id }));
}
