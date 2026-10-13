// /jobs — POST creates a print job, GET lists recent jobs, GET ?png=ID
// serves the stored preview PNG (lib/ops/jobs.js). Used by the Studio and
// Photo pages. Cookie-protected: never used by devices.
// The PNG is one owner's receipt behind their session, so only their
// browser may cache it (private), never a shared cache.

import { requestCaller } from '@/app/_lib/caller';
import { errorResponse, json } from '@/app/_lib/http';
import { jobsCreate, jobsImage, jobsList } from '@/lib/ops/jobs.js';

export const maxDuration = 60;

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  const params = new URL(req.url).searchParams;
  const png = params.get('png');
  if (png) {
    try {
      const image = await jobsImage(caller, { id: png });
      return new Response(new Uint8Array(image.body), {
        status: 200,
        headers: {
          'Content-Type': image.contentType,
          'Content-Length': String(image.body.length),
          'Cache-Control': 'private, max-age=86400',
        },
      });
    } catch (err) {
      return errorResponse(err);
    }
  }
  const limit = parseInt(params.get('limit') || '', 10) || undefined;
  return json(() => jobsList(caller, { limit }));
}

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = (await req.json().catch(() => null)) || {};
  return json(
    () =>
      jobsCreate(caller, {
        template: body.template,
        data: body.data,
        name: body.name,
        source: body.source,
      }),
    201,
  );
}
