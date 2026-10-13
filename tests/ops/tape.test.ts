// tests/ops/tape.test.ts — the take ops (lib/ops/tape.js) where they hold
// logic, under the hosted driver: tape.attachAudio refuses a recording
// uploaded under another owner's path (invalid; the PATCH route answers
// 400), and a take document over 4MB is too_large (the POST route answers
// 413) and saves nothing.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PATCH as takeRoute } from '@/app/api/tape/takes/[id]/route';
import { POST as takesRoute } from '@/app/api/tape/takes/route';
import { userCaller } from '@/lib/ops/caller.js';
import {
  tapeAttachAudio,
  tapeCreate,
  tapeGet,
  tapeList,
  tapeUpdate,
} from '@/lib/ops/tape.js';
import { put as fakePut, fetchStub } from '../helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('../helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/ops-tape`,
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

function account() {
  const id = `owner-${randomUUID()}`;
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}
type Account = ReturnType<typeof account>;

const DOC = { notes: [1, 2] };
const save = (a: Account) =>
  tapeCreate(a.caller, { name: 'Take', seconds: 1, noteCount: 2, doc: DOC });

// What the browser's client upload does: a suffixed pathname.
const upload = (pathname: string) =>
  fakePut(pathname, 'RIFF', { addRandomSuffix: true });

const request = (url: string, method: string, a: Account, body: unknown) =>
  new Request(`http://docket.test${url}`, {
    method,
    headers: { 'x-test-user': `${a.id}:user` },
    body: JSON.stringify(body),
  });

describe('tape.attachAudio', () => {
  it("refuses a recording under another owner's path; the route answers 400", async () => {
    const a = account();
    const { take, audio } = await save(a);
    expect(audio).toBe('client');
    // Same take id, uploaded under someone else's tape/ path.
    const theirs = await upload(`tape/${account().id}/${take.id}.wav`);

    await expect(
      tapeAttachAudio(a.caller, { id: take.id, audioUrl: theirs.url }),
    ).rejects.toMatchObject({
      name: 'OpError',
      code: 'invalid',
      message: 'audio upload failed',
    });
    const res = await takeRoute(
      request(`/api/tape/takes/${take.id}`, 'PATCH', a, {
        audioUrl: theirs.url,
      }),
      { params: Promise.resolve({ id: take.id }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'audio upload failed' });
    expect((await tapeGet(a.caller, { id: take.id })).take.hasAudio).toBe(
      false,
    );

    // The owner's own upload attaches.
    const own = await upload(`tape/${a.id}/${take.id}.wav`);
    const attached = await tapeAttachAudio(a.caller, {
      id: take.id,
      audioUrl: own.url,
    });
    expect(attached.take.hasAudio).toBe(true);
  });
});

describe('take documents over 4MB', () => {
  const big = { notes: 'x'.repeat(4 * 1024 * 1024) };
  const tooLarge = {
    name: 'OpError',
    code: 'too_large',
    message: 'take too large to save',
  };

  it('raise too_large on create, the route answers 413, and nothing is saved', async () => {
    const a = account();
    await expect(
      tapeCreate(a.caller, { name: 'Long', doc: big }),
    ).rejects.toMatchObject(tooLarge);

    const res = await takesRoute(
      request('/api/tape/takes', 'POST', a, { name: 'Long', doc: big }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'take too large to save' });
    expect(await tapeList(a.caller)).toEqual([]);
  });

  it('raise too_large on update and leave the saved document as it was', async () => {
    const a = account();
    const { take } = await save(a);
    await expect(
      tapeUpdate(a.caller, { id: take.id, doc: big }),
    ).rejects.toMatchObject(tooLarge);
    expect(await tapeGet(a.caller, { id: take.id })).toMatchObject({
      doc: DOC,
    });
  });
});
