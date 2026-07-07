// POST /api/jobs/reprint?job=ID — re-render from the stored template+data
// and queue a fresh job. Never resends old bytes: the render pipeline may
// have improved since the original print.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { createJob, getJob } from '@/lib/job-store.js';

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  const job = id ? await getJob(id) : null;
  if (!job)
    return Response.json({ error: 'record not found' }, { status: 404 });

  try {
    const result = await createJob({
      template: job.template,
      data: job.data,
      name: job.name || job.id,
      source: 'reprint',
    });
    return Response.json({ queued: result.id });
  } catch (err) {
    return Response.json(
      { error: `reprint failed · ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
