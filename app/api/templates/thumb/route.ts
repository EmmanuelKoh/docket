// GET /api/templates/thumb?name=X&v=V — renders a template with its stored
// default data and returns the PNG (templates.thumb), for slip-card
// previews. Rendering is the expensive part. v is the template's
// updatedAt plus the deploy's short commit hash (app/_lib/slip-data.ts
// thumbSrc): the same name and v always render the same image, so a
// versioned request is cached by the browser for good, and a save or a
// deploy changes the URL. Without v, short private caching as before.

import { requestCaller } from '@/app/_lib/caller';
import { errorResponse } from '@/app/_lib/http';
import { templatesThumb } from '@/lib/ops/templates.js';

export const maxDuration = 60;

const VERSIONED_CACHE = 'private, max-age=31536000, immutable';
const UNVERSIONED_CACHE = 'private, max-age=300';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  const params = new URL(req.url).searchParams;
  const name = params.get('name') ?? '';
  try {
    const png = await templatesThumb(caller, { name });
    return new Response(new Uint8Array(png.body), {
      status: 200,
      headers: {
        'Content-Type': png.contentType,
        'Content-Length': String(png.body.length),
        'Cache-Control': params.get('v') ? VERSIONED_CACHE : UNVERSIONED_CACHE,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
