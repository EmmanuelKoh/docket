// POST /api/tape/print — queue a take from the Tape tool. The browser
// renders the ESC/POS bytes itself (that's the tool's whole premise: the
// preview IS the print bytes), so this route just validates and stores —
// no Liquid, no Satori, no font tracing needed. Cookie session like the
// other dashboard JSON APIs.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { createRawJob } from '@/lib/job-store.js';

// Vercel's request cap is ~4.5MB; a very long take (base64-inflated)
// could brush it. Reject clearly rather than opaquely.
const MAX_B64 = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: 'invalid JSON' }, { status: 400 });
  const { bytes, png, width, height, name } = body;
  if (typeof bytes !== 'string' || typeof png !== 'string' || !bytes || !png) {
    return Response.json(
      { error: 'bytes and png (base64) required' },
      { status: 400 },
    );
  }
  if (bytes.length > MAX_B64 || png.length > MAX_B64) {
    return Response.json(
      { error: 'take too long for one job — split it' },
      { status: 413 },
    );
  }

  try {
    const result = await createRawJob(owner, {
      name: typeof name === 'string' && name ? name : 'Tape take',
      source: 'tape',
      bytes: Buffer.from(bytes, 'base64'),
      png: Buffer.from(png, 'base64'),
      width: Number(width) || 576,
      height: Number(height) || 0,
    });
    return Response.json(
      { id: result.id, status: result.status },
      { status: 201 },
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
