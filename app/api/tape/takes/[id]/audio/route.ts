// /api/tape/takes/{id}/audio — the take's recording.
//   GET → the WAV: a 302 to its Blob URL when hosted, streamed from
//         data/tape/ under the local JSON driver — the client never
//         needs to know which
//   PUT → local-driver upload (dev has no platform request cap; hosted
//         audio goes browser → Blob via the client-upload flow instead)

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import {
  audioUploadMode,
  getTakeAudio,
  saveTakeAudio,
} from '@/lib/tape-store.js';

const SAFE_ID = /^[a-z0-9-]{8,64}$/i;
// 10-min cap at 22.05kHz 16-bit mono ≈ 26MB; leave generous headroom
const MAX_WAV = 64 * 1024 * 1024;
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return Response.json({ error: 'no such take' }, { status: 404 });
  }
  try {
    const audio: { url?: string; buffer?: Buffer } | null =
      await getTakeAudio(id);
    if (audio?.url) return Response.redirect(audio.url, 302);
    const buf = audio?.buffer;
    if (!buf) {
      return Response.json(
        { error: 'no audio for this take' },
        { status: 404 },
      );
    }
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buf.length),
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  if (audioUploadMode() !== 'direct') {
    return Response.json(
      { error: 'hosted audio uploads go straight to Blob' },
      { status: 400 },
    );
  }
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return Response.json({ error: 'no such take' }, { status: 404 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_WAV) {
    return Response.json({ error: 'audio too large' }, { status: 413 });
  }
  try {
    return Response.json({ take: await saveTakeAudio(id, buf) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
