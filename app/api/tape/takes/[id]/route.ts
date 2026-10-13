// /api/tape/takes/{id} — one saved take (lib/ops/tape.js).
//   GET    → { take, settings, doc } (meta + the stored payload)
//   PATCH  → save in place, attach the client-uploaded audio, or undelete
//   DELETE → tombstone the take (restorable for 30 days)
// Cookie session like the other dashboard JSON APIs.

import { requestCaller } from '@/app/_lib/caller';
import { json, signInRequired } from '@/app/_lib/http';
import {
  tapeAttachAudio,
  tapeDelete,
  tapeGet,
  tapeRestore,
  tapeUpdate,
} from '@/lib/ops/tape.js';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const caller = await requestCaller(req);
  const { id } = await params;
  return json(() => tapeGet(caller, { id }));
}

// PATCH carries an in-place update ({ name, noteCount, settings, doc } —
// the session is tied to this take; audio untouched), the audio-attach
// step after a client upload ({ audioUrl }), or an undelete
// ({ restore: true } — deletes are soft tombstones for 30 days).
export async function PATCH(req: Request, { params }: Params) {
  const caller = await requestCaller(req);
  if (!caller) return signInRequired(); // before reading the body
  const { id } = await params;
  const body = (await req.json().catch(() => null)) || {};
  return json(() => {
    if (body.restore === true) return tapeRestore(caller, { id });
    if (body.doc && typeof body.doc === 'object') {
      return tapeUpdate(caller, {
        id,
        name: body.name,
        noteCount: body.noteCount,
        settings: body.settings,
        doc: body.doc,
      });
    }
    return tapeAttachAudio(caller, { id, audioUrl: body.audioUrl });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const caller = await requestCaller(req);
  const { id } = await params;
  return json(() => tapeDelete(caller, { id }));
}
