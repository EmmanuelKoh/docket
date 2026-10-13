// tests/routes/tape-takes.test.ts — the takes routes under the hosted
// driver: a new take tells the browser to upload its WAV straight to Blob
// (audioUploadMode stays synchronous), the audio attach answers 400 for a
// URL the store refuses, now that the route no longer checks hosts, and
// the upload route refuses a request with no session unless it is Blob's
// own signed upload-completed callback.

import { randomUUID } from 'node:crypto';
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

it('the upload route: 401 without a session, but a signed callback reaches handleUpload', async () => {
  const completed = JSON.stringify({
    type: 'blob.upload-completed',
    payload: { blob: { url: 'x' }, tokenPayload: null },
  });
  const anonymous = new Request('http://docket.test/api/tape/takes/upload', {
    method: 'POST',
    body: completed,
  });
  const res = await uploadRoute(anonymous);
  expect(res.status).toBe(401);
  expect(anonymous.bodyUsed).toBe(false);

  // Blob's callback carries no session, only a signature handleUpload
  // checks (this one is wrong, so it answers 400, not 401).
  const signed = await uploadRoute(
    new Request('http://docket.test/api/tape/takes/upload', {
      method: 'POST',
      headers: { 'x-vercel-signature': 'deadbeef' },
      body: completed,
    }),
  );
  expect(signed.status).toBe(400);
  expect(await signed.json()).toEqual({
    error: 'Vercel Blob: Invalid callback signature',
  });
});
