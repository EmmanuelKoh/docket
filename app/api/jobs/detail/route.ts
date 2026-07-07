// GET /api/jobs/detail?job=ID — the expanded-row debug record: template
// source and input data, both clipped. The panel is a glance at the
// record, not an editor (Reprint uses the full stored inputs regardless).

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getJob } from '@/lib/job-store.js';

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n…` : s;

export async function GET(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  if (!id) {
    return Response.json(
      { error: 'job query parameter is required' },
      { status: 400 },
    );
  }

  const job = await getJob(id);
  if (!job)
    return Response.json({ error: 'record not found' }, { status: 404 });

  return Response.json({
    id: job.id,
    template: clip(job.template || '', 600),
    dataJson: clip(JSON.stringify(job.data || {}, null, 2), 600),
  });
}
