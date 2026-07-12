// POST /api/jobs/reprint?job=ID — re-render from the stored template+data
// and queue a fresh job. Never resends old bytes: the render pipeline may
// have improved since the original print.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { createJob, getJob } from '@/lib/job-store.js';

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  const job = id ? await getJob(owner, id) : null;
  if (!job)
    return Response.json({ error: 'record not found' }, { status: 404 });
  // Raw-bytes jobs (source: tape) carry no template to re-render from.
  if (!job.template)
    return Response.json(
      { error: 'raw-bytes job — print it again from its tool page' },
      { status: 400 },
    );

  try {
    const result = await createJob(owner, {
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
