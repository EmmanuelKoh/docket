// GET /api/jobs/png?job=ID — the stored preview PNG for thumbnails, for
// rows jobs.list gives no imageUrl (local, where the PNG is inline in the
// row); hosted pages load the artifact's public URL instead
// (app/_lib/format.ts jobImageSrc). Session-gated like every dashboard
// JSON/asset route (the legacy equivalent is GET /jobs?png=ID). A job's
// PNG never changes, so short private caching keeps repeat paints free.

import { requestCaller } from '@/app/_lib/caller';
import { errorResponse } from '@/app/_lib/http';
import { jobsImage } from '@/lib/ops/jobs.js';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job') ?? '';
  try {
    const png = await jobsImage(caller, { id });
    return new Response(new Uint8Array(png.body), {
      status: 200,
      headers: {
        'Content-Type': png.contentType,
        'Content-Length': String(png.body.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
