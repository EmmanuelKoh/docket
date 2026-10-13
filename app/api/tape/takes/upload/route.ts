// POST /api/tape/takes/upload — mint a client-upload token for a take's
// WAV (hosted driver only). The browser uploads straight to Vercel Blob,
// because a long take's WAV exceeds the ~4.5MB request cap every normal
// route lives under; the resulting URL is then attached to the take via
// PATCH /api/tape/takes/{id}. handleUpload speaks Vercel's client-upload
// protocol; tape.authorizeUpload decides who may upload where.

import { handleUpload } from '@vercel/blob/client';
import { requestCaller } from '@/app/_lib/caller';
import { errorResponse, signInRequired } from '@/app/_lib/http';
import { tapeAuthorizeUpload } from '@/lib/ops/tape.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  // No session: 401 before the body and handleUpload (which resolves the
  // Blob token first, so a tokenless local request would get its 400).
  // The one sessionless request handleUpload must see is Blob's own
  // upload-completed callback, which carries a signature it verifies.
  if (!caller && !req.headers.has('x-vercel-signature')) {
    return signInRequired();
  }
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: 'invalid JSON' }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: (pathname) =>
        tapeAuthorizeUpload(caller, { pathname }),
      onUploadCompleted: async () => {
        // the browser PATCHes the URL onto the take itself (this
        // callback doesn't fire from localhost anyway)
      },
    });
    return Response.json(result);
  } catch (err) {
    // Op refusals by their code; the protocol's own errors stay 400.
    if ((err as Error)?.name === 'OpError') return errorResponse(err);
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
