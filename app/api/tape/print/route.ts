// POST /api/tape/print — queue a take from the Tape tool. The browser
// renders the ESC/POS bytes itself (that's the tool's whole premise: the
// preview IS the print bytes), so this route just hands them to
// jobs.createRaw (lib/ops/jobs.js), which validates and stores — no
// Liquid, no Satori, no font tracing needed. Cookie session like the
// other dashboard JSON APIs.

import { requestCaller } from '@/app/_lib/caller';
import { json, signInRequired } from '@/app/_lib/http';
import { TAPE_ENCODER } from '@/components/tape-renderer.js';
import { jobsCreateRaw } from '@/lib/ops/jobs.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  if (!caller) return signInRequired(); // before reading two base64 payloads
  const body = (await req.json().catch(() => null)) || {};
  return json(async () => {
    const { id, status } = await jobsCreateRaw(caller, {
      bytes: body.bytes,
      png: body.png,
      width: body.width,
      height: body.height,
      // Tape's labels in History (the op has no defaults of its own)
      name:
        typeof body.name === 'string' && body.name ? body.name : 'Tape take',
      source: 'tape',
      // the framing of the renderer's toEscpos: one raster, upright
      encoding: {
        mode: 'raster',
        rotate: 0,
        flushCut: false,
        encoder: TAPE_ENCODER,
      },
    });
    return { id, status };
  }, 201);
}
