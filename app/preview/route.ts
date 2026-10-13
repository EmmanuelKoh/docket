// POST /preview — renders a Liquid template + data through the real render
// core and returns the 1-bit dithered PNG (exactly what the printer would
// produce), via templates.preview. The Studio and Photo pages call it.

import { requestCaller } from '@/app/_lib/caller';
import { errorResponse } from '@/app/_lib/http';
import { templatesPreview } from '@/lib/ops/templates.js';

export const maxDuration = 60;

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = (await req.json().catch(() => null)) || {};
  try {
    const image = await templatesPreview(caller, {
      template: body.template,
      data: body.data,
    });
    return new Response(new Uint8Array(image.body), {
      status: 200,
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.body.length),
        'X-Image-Width': String(image.width),
        'X-Image-Height': String(image.height),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
