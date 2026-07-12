// /jobs — POST creates a print job, GET lists recent jobs, GET ?png=ID
// serves the stored preview PNG. Ported from api/jobs.js at the same path
// for the studio. Cookie-protected: never used by devices.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { createJob, getJobPng, listJobs } from '@/lib/job-store.js';

export const maxDuration = 60;

export async function GET(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const params = new URL(req.url).searchParams;
  const png = params.get('png');
  if (png) {
    const bytes = await getJobPng(owner, png);
    if (!bytes)
      return Response.json({ error: 'job not found' }, { status: 404 });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
  const limit = parseInt(params.get('limit') || '', 10) || 20;
  return Response.json(await listJobs(owner, limit));
}

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const { template, data, name, source } =
    (await req.json().catch(() => ({}))) || {};
  if (!template) {
    return Response.json({ error: 'template is required' }, { status: 400 });
  }
  try {
    const result = await createJob(owner, {
      template,
      data,
      name,
      source: source || 'studio',
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
