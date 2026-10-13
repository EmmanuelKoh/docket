// /api/tape/takes/{id}/audio — the take's recording (lib/ops/tape.js).
//   GET → the WAV: a 302 to its Blob URL when hosted, streamed from
//         data/tape/ under the local JSON driver — the client never
//         needs to know which
//   PUT → local-driver upload (dev has no platform request cap; hosted
//         audio goes browser → Blob via the client-upload flow instead)

import { requestCaller } from '@/app/_lib/caller';
import { errorResponse, json, signInRequired } from '@/app/_lib/http';
import { tapeGetAudio, tapePutAudio } from '@/lib/ops/tape.js';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const caller = await requestCaller(req);
  const { id } = await params;
  try {
    const found = await tapeGetAudio(caller, { id });
    if (!found.audio) return Response.redirect(found.url, 302);
    const { contentType, body } = found.audio;
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const caller = await requestCaller(req);
  if (!caller) return signInRequired(); // before reading a WAV-sized body
  const { id } = await params;
  const body = Buffer.from(await req.arrayBuffer());
  return json(() =>
    tapePutAudio(caller, { id, audio: { contentType: 'audio/wav', body } }),
  );
}
