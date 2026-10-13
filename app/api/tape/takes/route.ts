// GET /api/tape/takes — purge tombstones past 30 days (tape.purge), then
// list saved takes (tape.list): meta only, one cheap read; the purge is
// one more unless a tombstone expired.
// POST /api/tape/takes — save a take (tape.create): meta + payload (the
// take document and the control settings). The audio follows in a second
// step — a client upload to Blob when hosted, or a direct PUT to
// .../{id}/audio under the local JSON driver — so this route stays small.
// Cookie session like the other dashboard JSON APIs.

import { requestCaller } from '@/app/_lib/caller';
import { json, signInRequired } from '@/app/_lib/http';
import { tapeCreate, tapeList, tapePurge } from '@/lib/ops/tape.js';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  return json(async () => {
    await tapePurge(caller);
    return { takes: await tapeList(caller) };
  });
}

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  if (!caller) return signInRequired(); // before reading the body
  const body = (await req.json().catch(() => null)) || {};
  return json(
    () =>
      tapeCreate(caller, {
        name: body.name,
        seconds: body.seconds,
        sampleRate: body.sampleRate,
        noteCount: body.noteCount,
        settings: body.settings,
        doc: body.doc,
      }),
    201,
  );
}
