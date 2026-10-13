// tests/routes/tape-anonymous.test.ts — the Tape routes that take a body
// (a print's base64 bytes and PNG, a take document, a WAV, the
// client-upload handshake) answer a request with no session 401 before
// they read that body. Locally the upload route would otherwise reach
// handleUpload, which answers 400 without a Blob token before any session
// check.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as print from '@/app/api/tape/print/route';
import * as audio from '@/app/api/tape/takes/[id]/audio/route';
import * as take from '@/app/api/tape/takes/[id]/route';
import * as takes from '@/app/api/tape/takes/route';
import * as upload from '@/app/api/tape/takes/upload/route';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-tape-anonymous`;
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const id = randomUUID();
const params = { params: Promise.resolve({ id }) };
const request = (path: string, method: string, body: string) =>
  new Request(`http://docket.test${path}`, { method, body });

it.each([
  [
    'POST /api/tape/print',
    () =>
      request(
        '/api/tape/print',
        'POST',
        '{"bytes":"AAAA","png":"AAAA","width":576,"height":1}',
      ),
    (req: Request) => print.POST(req),
  ],
  [
    'POST /api/tape/takes',
    () => request('/api/tape/takes', 'POST', '{"doc":{}}'),
    (req: Request) => takes.POST(req),
  ],
  [
    'PATCH /api/tape/takes/{id}',
    () => request(`/api/tape/takes/${id}`, 'PATCH', '{"restore":true}'),
    (req: Request) => take.PATCH(req, params),
  ],
  [
    'PUT /api/tape/takes/{id}/audio',
    () => request(`/api/tape/takes/${id}/audio`, 'PUT', 'RIFF'),
    (req: Request) => audio.PUT(req, params),
  ],
  [
    'POST /api/tape/takes/upload',
    () =>
      request(
        '/api/tape/takes/upload',
        'POST',
        JSON.stringify({
          type: 'blob.generate-client-token',
          payload: { pathname: `tape/someone/${id}.wav` },
        }),
      ),
    (req: Request) => upload.POST(req),
  ],
])('%s without a session: 401, body unread', async (_name, make, route) => {
  const req = make();
  const res = await route(req);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'sign in required' });
  expect(req.bodyUsed).toBe(false);
});
