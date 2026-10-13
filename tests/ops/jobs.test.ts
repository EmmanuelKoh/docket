// tests/ops/jobs.test.ts — the job ops (lib/ops/jobs.js) where they hold
// logic: reprint refuses a raw job, cancel leaves a claimed job alone (and
// the cancel route answers the queue view over jobs.list), requeue takes
// only a queued or printing job, createRaw caps the payload and labels a
// job only as its producer says (the Tape route says Tape), and create
// keeps the source the caller sends.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as cancelRoute } from '@/app/api/jobs/cancel/route';
import { POST as reprintRoute } from '@/app/api/jobs/reprint/route';
import { POST as requeueRoute } from '@/app/api/jobs/requeue/route';
import { POST as tapePrintRoute } from '@/app/api/tape/print/route';
import { ackJob, nextJob } from '@/lib/job-store.js';
import { userCaller } from '@/lib/ops/caller.js';
import {
  jobsCancel,
  jobsCreate,
  jobsCreateRaw,
  jobsList,
  jobsReprint,
  jobsRequeue,
} from '@/lib/ops/jobs.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/job-kind.test.ts does), so a developer's .env cannot change what
// renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-jobs`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
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

function account() {
  const id = `owner-${randomUUID()}`;
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}
type Account = ReturnType<typeof account>;

const b64 = (b: Buffer) => b.toString('base64');
const TAPE = {
  mode: 'raster',
  rotate: 0,
  flushCut: false,
  encoder: 'tape-renderer/1',
} as const;

// A Tape-style print: bytes the caller rendered, no template.
const rawJob = (a: Account) =>
  jobsCreateRaw(a.caller, {
    bytes: b64(Buffer.from([0x1b, 0x40, 0x0a])),
    png: b64(Buffer.from('png')),
    width: 576,
    height: 1,
    name: 'take',
    encoding: TAPE,
  });

const post = (
  route: (req: Request) => Promise<Response>,
  url: string,
  a: Account,
  body?: unknown,
) =>
  route(
    new Request(`http://docket.test${url}`, {
      method: 'POST',
      headers: { 'x-test-user': `${a.id}:user` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const statuses = async (a: Account) =>
  Object.fromEntries(
    (await jobsList(a.caller)).map((j: { id: string; status: string }) => [
      j.id,
      j.status,
    ]),
  );

describe('jobs.reprint', () => {
  it('refuses a raw job: invalid, and the route answers 400', async () => {
    const a = account();
    const { id } = await rawJob(a);
    const refusal = 'printed from a tool — print it again there';

    await expect(jobsReprint(a.caller, { id })).rejects.toMatchObject({
      name: 'OpError',
      code: 'invalid',
      message: refusal,
    });
    const res = await post(
      reprintRoute,
      `/api/jobs/reprint?job=${encodeURIComponent(id)}`,
      a,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: refusal });
    expect(await statuses(a)).toEqual({ [id]: 'queued' }); // nothing new queued
  });
});

describe('jobs.cancel', () => {
  it('answers false for a job a printer has claimed, and cancels a queued one', async () => {
    const a = account();
    const first = await rawJob(a);
    const second = await rawJob(a);
    const third = await rawJob(a);

    // The printer claims the oldest: it may already be printing.
    expect((await nextJob(a.id))?.id).toBe(first.id);
    expect(await jobsCancel(a.caller, { id: first.id })).toEqual({
      canceled: false,
    });
    expect(await jobsCancel(a.caller, { id: second.id })).toEqual({
      canceled: true,
    });

    // The route cancels, then answers the queue view: live jobs only,
    // oldest first.
    const res = await post(
      cancelRoute,
      `/api/jobs/cancel?job=${encodeURIComponent(third.id)}`,
      a,
    );
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.count).toBe(1);
    expect(view.jobs).toEqual([
      expect.objectContaining({
        id: first.id,
        inflight: true,
        statusText: 'printing',
      }),
    ]);

    expect(await statuses(a)).toEqual({
      [first.id]: 'inflight',
      [second.id]: 'canceled',
      [third.id]: 'canceled',
    });
  });
});

describe('jobs.requeue', () => {
  it('puts a printing or queued job back; refuses a done or canceled one with conflict', async () => {
    const a = account();
    const printing = await rawJob(a);
    const waiting = await rawJob(a);
    expect((await nextJob(a.id))?.id).toBe(printing.id);

    expect(await jobsRequeue(a.caller, { id: printing.id })).toEqual({
      requeued: true,
    });
    expect(await jobsRequeue(a.caller, { id: waiting.id })).toEqual({
      requeued: true,
    });
    expect(await statuses(a)).toEqual({
      [printing.id]: 'queued',
      [waiting.id]: 'queued',
    });

    // Printed and acked: requeue would print it a second time.
    expect((await nextJob(a.id))?.id).toBe(printing.id);
    await ackJob(a.id, printing.id);
    await jobsCancel(a.caller, { id: waiting.id });
    for (const [id, status] of [
      [printing.id, 'done'],
      [waiting.id, 'canceled'],
    ]) {
      await expect(jobsRequeue(a.caller, { id })).rejects.toMatchObject({
        name: 'OpError',
        code: 'conflict',
        message: `a ${status} job cannot be requeued`,
      });
    }
    const res = await post(
      requeueRoute,
      `/api/jobs/requeue?job=${encodeURIComponent(printing.id)}`,
      a,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'a done job cannot be requeued',
    });
    expect(await statuses(a)).toEqual({
      [printing.id]: 'done',
      [waiting.id]: 'canceled',
    });
    expect(await nextJob(a.id)).toBeNull(); // nothing went back in the queue

    // No such job: nothing to requeue, as before.
    expect(await jobsRequeue(a.caller, { id: 'job-999' })).toEqual({
      requeued: false,
    });
  });
});

describe('jobs.createRaw', () => {
  it("has no producer's defaults; the Tape route labels its jobs tape", async () => {
    const a = account();
    const bytes = b64(Buffer.from([0x1b, 0x40, 0x0a]));
    const png = b64(Buffer.from('png'));
    const bare = await jobsCreateRaw(a.caller, { bytes, png });
    const res = await post(tapePrintRoute, '/api/tape/print', a, {
      bytes,
      png,
      width: 576,
      height: 1,
    });
    expect(res.status).toBe(201);
    const tape = await res.json();

    const labels = Object.fromEntries(
      (await jobsList(a.caller)).map(
        (j: { id: string; name: string; source: string }) => [
          j.id,
          { name: j.name, source: j.source },
        ],
      ),
    );
    expect(labels).toEqual({
      [bare.id]: { name: '', source: '' },
      [tape.id]: { name: 'Tape take', source: 'tape' },
    });
  });

  it('raises too_large over 3MB of base64, and the route answers 413', async () => {
    const a = account();
    const big = 'A'.repeat(3 * 1024 * 1024 + 4);
    const small = b64(Buffer.from('png'));
    const tooLong = 'take too long for one job — split it';

    await expect(
      jobsCreateRaw(a.caller, { bytes: big, png: small }),
    ).rejects.toMatchObject({ code: 'too_large', message: tooLong });
    const res = await post(tapePrintRoute, '/api/tape/print', a, {
      bytes: small,
      png: big,
      width: 576,
      height: 1,
      name: 'long take',
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: tooLong });
    expect(await statuses(a)).toEqual({});
  });
});

describe('jobs.create', () => {
  it("keeps the caller's source (Photo sends photo); Studio is the default", async () => {
    const a = account();
    const template = '<div style="display:flex;font-size:28px">{{ who }}</div>';
    const photo = await jobsCreate(a.caller, {
      template,
      data: { who: 'photo' },
      name: 'Photo Print',
      source: 'photo',
    });
    expect(photo).toEqual({
      id: expect.any(String),
      status: 'queued',
      width: 576,
      height: expect.any(Number),
    });
    const studio = await jobsCreate(a.caller, { template, name: 'untitled' });

    const sources = Object.fromEntries(
      (await jobsList(a.caller)).map((j: { id: string; source: string }) => [
        j.id,
        j.source,
      ]),
    );
    expect(sources).toEqual({ [photo.id]: 'photo', [studio.id]: 'studio' });
  });
});
