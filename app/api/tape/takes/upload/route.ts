// POST /api/tape/takes/upload — mint a client-upload token for a take's
// WAV (hosted driver only). The browser uploads straight to Vercel Blob,
// because a long take's WAV exceeds the ~4.5MB request cap every normal
// route lives under; the resulting URL is then attached to the take via
// PATCH /api/tape/takes/{id}. Cookie session gates who can mint tokens.

import { handleUpload } from '@vercel/blob/client';
import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { audioUploadMode } from '@/lib/tape-store.js';

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  if (audioUploadMode() !== 'client') {
    return Response.json(
      { error: 'client upload needs the redis driver' },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: 'invalid JSON' }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`tape/${owner}/`)) {
          throw new Error('unexpected upload path');
        }
        return {
          allowedContentTypes: ['audio/wav', 'audio/x-wav'],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // the browser PATCHes the URL onto the take itself (this
        // callback doesn't fire from localhost anyway)
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
