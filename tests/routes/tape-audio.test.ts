// tests/routes/tape-audio.test.ts — GET /api/tape/takes/{id}/audio turns
// tape.getAudio's answer into HTTP: a 302 to the Blob URL when hosted, the
// WAV streamed with its length locally. Locally the WAV goes up by PUT on
// the same route (the request body becomes tape.putAudio's Binary).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as localRoute from '@/app/api/tape/takes/[id]/audio/route';
import { userCaller } from '@/lib/ops/caller.js';
import * as localOps from '@/lib/ops/tape.js';
import { put as fakePut, fetchStub, HOSTED_ENV } from '../helpers/fake-hosted';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-tape-audio`;
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));
// Inert until the hosted block reloads the modules with HOSTED_ENV.
vi.mock('@upstash/redis', () => import('../helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('../helpers/fake-hosted'));

const noNetwork = () => {
  throw new Error('network access is disabled in tests');
};

beforeAll(() => {
  vi.stubGlobal('fetch', noNetwork);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function account() {
  const id = `owner-${randomUUID()}`;
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}
type Account = ReturnType<typeof account>;

const audioUrl = (id: string) =>
  `http://docket.test/api/tape/takes/${id}/audio`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asUser = (a: Account) => ({ 'x-test-user': `${a.id}:user` });

describe('locally', () => {
  it('PUT stores the WAV, and GET streams it back', async () => {
    const a = account();
    const { take, audio } = await localOps.tapeCreate(a.caller, {
      doc: { notes: [] },
    });
    expect(audio).toBe('direct');

    const missing = await localRoute.GET(
      new Request(audioUrl(take.id), { headers: asUser(a) }),
      params(take.id),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no audio for this take' });

    const wav = Buffer.from('RIFF-local-take');
    const put = await localRoute.PUT(
      new Request(audioUrl(take.id), {
        method: 'PUT',
        headers: { ...asUser(a), 'Content-Type': 'audio/wav' },
        body: new Uint8Array(wav),
      }),
      params(take.id),
    );
    expect(put.status).toBe(200);
    expect((await put.json()).take.hasAudio).toBe(true);

    const res = await localRoute.GET(
      new Request(audioUrl(take.id), { headers: asUser(a) }),
      params(take.id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('content-length')).toBe(String(wav.length));
    expect(Buffer.from(await res.arrayBuffer())).toEqual(wav);

    // Another account gets no take, not the recording.
    const other = await localRoute.GET(
      new Request(audioUrl(take.id), { headers: asUser(account()) }),
      params(take.id),
    );
    expect(other.status).toBe(404);
  });
});

describe('hosted', () => {
  let route: typeof localRoute;
  let ops: typeof localOps;

  beforeAll(async () => {
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    vi.stubGlobal('fetch', fetchStub);
    vi.resetModules();
    route = await import('@/app/api/tape/takes/[id]/audio/route');
    ops = await import('@/lib/ops/tape.js');
  });

  afterAll(() => {
    vi.stubGlobal('fetch', noNetwork);
  });

  it('GET redirects to the attached Blob URL', async () => {
    const a = account();
    const { take, audio } = await ops.tapeCreate(a.caller, {
      doc: { notes: [] },
    });
    expect(audio).toBe('client');
    const wav = await fakePut(`tape/${a.id}/${take.id}.wav`, 'RIFF', {
      addRandomSuffix: true,
    });
    await ops.tapeAttachAudio(a.caller, { id: take.id, audioUrl: wav.url });

    const res = await route.GET(
      new Request(audioUrl(take.id), { headers: asUser(a) }),
      params(take.id),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(wav.url);
  });
});
