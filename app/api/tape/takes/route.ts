// GET /api/tape/takes — list saved takes (meta only, one cheap read).
// POST /api/tape/takes — save a take: meta + payload (the take document
// and the control settings). The audio follows in a second step — a
// client upload to Blob when hosted, or a direct PUT to .../{id}/audio
// under the local JSON driver — so this route stays small.
// Cookie session like the other dashboard JSON APIs.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { audioUploadMode, createTake, listTakes } from '@/lib/tape-store.js';

// stay clear of the platform's ~4.5MB request cap; a take document is
// usually tens of KB
const MAX_BODY = 4 * 1024 * 1024;

export async function GET(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  try {
    return Response.json({ takes: await listTakes() });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();
  const text = await req.text();
  if (text.length > MAX_BODY) {
    return Response.json({ error: 'take too large to save' }, { status: 413 });
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* handled below */
  }
  if (!body) return Response.json({ error: 'invalid JSON' }, { status: 400 });
  const { name, seconds, sampleRate, noteCount, settings, doc } = body;
  if (!doc || typeof doc !== 'object') {
    return Response.json({ error: 'doc required' }, { status: 400 });
  }
  try {
    const take = await createTake({
      name:
        typeof name === 'string' && name.trim()
          ? name.trim().slice(0, 80)
          : 'Take',
      seconds: Number(seconds) || 0,
      sampleRate: Number(sampleRate) || 22050,
      noteCount: Number(noteCount) || 0,
      payload: { settings, doc },
    });
    return Response.json({ take, audio: audioUploadMode() }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
