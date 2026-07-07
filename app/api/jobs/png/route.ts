// GET /api/jobs/png?job=ID — the stored preview PNG for thumbnails.
// Session-gated like every dashboard JSON/asset route (the legacy
// equivalent is GET /jobs?png=ID). A job's PNG never changes, so short
// private caching keeps repeat paints free.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getJobPng } from '@/lib/job-store.js';

export async function GET(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('job');
  if (!id) {
    return Response.json(
      { error: 'job query parameter is required' },
      { status: 400 },
    );
  }

  const png = await getJobPng(id);
  if (!png) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
