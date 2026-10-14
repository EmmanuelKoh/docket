// tests/routes/tape-takes.test.ts — the takes routes under the hosted
// driver: a new take tells the browser to upload its WAV straight to Blob
// (audioUploadMode stays synchronous), the audio attach answers 400 for a
// URL the store refuses, now that the route no longer checks hosts, and
// the upload route refuses every request with no session (a signed
// callback too, since its tokens ask Blob for none) and mints a token
// through the real @vercel/blob/client handleUpload.

import { randomUUID } from 'node:crypto';
import { getPayloadFromClientToken } from '@vercel/blob/client';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/tape/takes/[id]/route';
import { POST } from '@/app/api/tape/takes/route';
import { POST as uploadRoute } from '@/app/api/tape/takes/upload/route';
import { put as fakePut, fetchStub } from '../helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('../helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/routes-tape-takes`,
  });
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));
vi.mock('@upstash/redis', () => import('../helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('../helpers/fake-hosted'));

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = `owner-${randomUUID()}`;

function request(url: string, method: string, body: unknown) {
  return new Request(`http://docket.test${url}`, {
    method,
    headers: { 'x-test-user': `${owner}:user` },
    body: JSON.stringify(body),
  });
}

async function createTake() {
  const res = await POST(
    request('/api/tape/takes', 'POST', {
      name: 'Take',
      seconds: 1,
      sampleRate: 22050,
      noteCount: 0,
      settings: {},
      doc: { notes: [] },
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function attach(id: string, audioUrl: unknown) {
  const res = await PATCH(
    request(`/api/tape/takes/${id}`, 'PATCH', { audioUrl }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

it("POST /api/tape/takes answers audio: 'client'", async () => {
  const { status, body } = await createTake();
  expect(status).toBe(201);
  expect(body.audio).toBe('client');
  expect(body.take.ownerId).toBe(owner);
  expect(body.take).not.toHaveProperty('docUrl');
});

it('PATCH attaches an uploaded WAV, and answers 400 for a refused URL', async () => {
  const { body } = await createTake();
  const id = body.take.id;
  const wav = await fakePut(`tape/${owner}/${id}.wav`, 'RIFF', {
    addRandomSuffix: true,
  });

  const foreign = `https://otherstore.public.blob.vercel-storage.com/tape/${owner}/${id}-r1.wav`;
  for (const url of [foreign, 'not a url', 42]) {
    expect(await attach(id, url)).toEqual({
      status: 400,
      body: { error: 'audio upload failed' },
    });
  }

  const ok = await attach(id, wav.url);
  expect(ok.status).toBe(200);
  expect(ok.body.take.hasAudio).toBe(true);
});

it('the upload route: 401 without a session, a signed callback included', async () => {
  const completed = JSON.stringify({
    type: 'blob.upload-completed',
    payload: { blob: { url: 'x' }, tokenPayload: null },
  });
  for (const headers of [{}, { 'x-vercel-signature': 'deadbeef' }]) {
    const anonymous = new Request('http://docket.test/api/tape/takes/upload', {
      method: 'POST',
      headers,
      body: completed,
    });
    const res = await uploadRoute(anonymous);
    expect(res.status).toBe(401);
    expect(anonymous.bodyUsed).toBe(false);
  }
});

it('the upload route mints a client token for your own tape/ path, with no callback', async () => {
  const generate = (pathname: string) =>
    uploadRoute(
      request('/api/tape/takes/upload', 'POST', {
        type: 'blob.generate-client-token',
        payload: { pathname, multipart: false, clientPayload: null },
      }),
    );

  // With a callback URL set, a route that passed onUploadCompleted would
  // put a callback in the token.
  vi.stubEnv('VERCEL_BLOB_CALLBACK_URL', 'https://docket.test');
  const pathname = `tape/${owner}/${randomUUID()}.wav`;
  const res = await generate(pathname);
  vi.unstubAllEnvs();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.type).toBe('blob.generate-client-token');
  const payload = getPayloadFromClientToken(body.clientToken);
  expect(payload).toMatchObject({
    pathname,
    allowedContentTypes: ['audio/wav', 'audio/x-wav'],
    addRandomSuffix: true,
  });
  expect(payload).not.toHaveProperty('onUploadCompleted');
  expect(payload.validUntil).toBeGreaterThan(Date.now());

  const foreign = await generate(`tape/someone-else/${randomUUID()}.wav`);
  expect(foreign.status).toBe(400);
  expect(await foreign.json()).toEqual({ error: 'unexpected upload path' });
});
