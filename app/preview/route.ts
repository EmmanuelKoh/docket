// POST /preview — renders a Liquid template + data through the real render
// core and returns the 1-bit dithered PNG (exactly what the printer would
// produce). Ported from api/preview.js at the same path for the studio.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { renderToPreview } from '@/render/render-core.js';

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const { template, data } = (await req.json().catch(() => ({}))) || {};
  if (!template) {
    return Response.json({ error: 'template is required' }, { status: 400 });
  }

  try {
    const result = await renderToPreview(template, data || {});
    return new Response(new Uint8Array(result.preview), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(result.preview.length),
        'X-Image-Width': String(result.width),
        'X-Image-Height': String(result.height),
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
