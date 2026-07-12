// /api/tape/takes/{id} — one saved take.
//   GET    → { take, settings, doc } (meta + the stored payload)
//   PATCH  → attach the client-uploaded audio URL (hosted driver)
//   DELETE → remove the take and its payloads
// Cookie session like the other dashboard JSON APIs.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import {
  attachTakeAudio,
  deleteTake,
  getTake,
  getTakePayload,
  restoreTake,
  updateTake,
} from '@/lib/tape-store.js';

const SAFE_ID = /^[a-z0-9-]{8,64}$/i;
const MAX_BODY = 4 * 1024 * 1024; // stay clear of the platform request cap
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return Response.json({ error: 'no such take' }, { status: 404 });
  }
  try {
    const take = await getTake(owner, id);
    if (!take) return Response.json({ error: 'no such take' }, { status: 404 });
    const payload = (await getTakePayload(owner, id)) || {};
    return Response.json({ take, ...payload });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH carries an in-place update ({ name, noteCount, settings, doc } —
// the session is tied to this take; audio untouched), the audio-attach
// step after a client upload ({ audioUrl }), or an undelete
// ({ restore: true } — deletes are soft tombstones for 30 days).
export async function PATCH(req: Request, { params }: Params) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return Response.json({ error: 'no such take' }, { status: 404 });
  }
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

  if (body.restore === true) {
    try {
      return Response.json({ take: await restoreTake(owner, id) });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 404 });
    }
  }

  if (body.doc && typeof body.doc === 'object') {
    try {
      const take = await updateTake(owner, id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        noteCount: Number(body.noteCount),
        payload: { settings: body.settings, doc: body.doc },
      });
      return Response.json({ take });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'no such take' ? 404 : 500;
      return Response.json({ error: msg }, { status });
    }
  }

  const audioUrl = body.audioUrl;
  let hostOk = false;
  try {
    hostOk =
      typeof audioUrl === 'string' &&
      new URL(audioUrl).hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    /* not a URL */
  }
  if (!hostOk) {
    return Response.json(
      { error: 'audioUrl must be a Blob URL' },
      { status: 400 },
    );
  }
  try {
    return Response.json({
      take: await attachTakeAudio(owner, id, audioUrl as string),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return Response.json({ error: 'no such take' }, { status: 404 });
  }
  try {
    await deleteTake(owner, id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
