// tests/job-requeue.test.ts — the dashboard's Requeue (job-store.requeueJob)
// against the hosted queue, where the job record (Postgres) and the queue
// (Redis) are two stores: a printer's /ack that lands in the middle of a
// requeue must still leave the job printed once.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ackJob,
  createRawJob,
  getJob,
  nextJob,
  requeueJob,
} from '@/lib/job-store.js';
import { getQueue } from '@/lib/queue/index.js';
import { fetchStub, listOf, zsetOf } from './helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('./helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/job-requeue`,
  });
});

vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('./helpers/fake-hosted'));

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;
const waiting = (o: string) => [...listOf(`rp:${o}:jobs:queue`)];
const leased = (o: string) => [...zsetOf(`rp:${o}:jobs:inflight`).keys()];

async function printing(o: string) {
  const { id } = await createRawJob(o, {
    name: 'Requeue test',
    source: 'test',
    bytes: Buffer.from([0x1b, 0x40, 0x0a]),
    png: Buffer.from('png'),
    width: 576,
    height: 1,
  });
  expect((await nextJob(o))?.id).toBe(id);
  return id;
}

describe('requeueJob, hosted', () => {
  it('puts a printing job back at the front', async () => {
    const o = owner();
    const id = await printing(o);

    expect(await requeueJob(o, id)).toEqual({
      requeued: true,
      status: 'queued',
    });
    expect(leased(o)).toEqual([]);
    expect(waiting(o)).toEqual([id]);
    expect((await nextJob(o))?.id).toBe(id);
  });

  it('an ack between the status write and the queue push still prints once', async () => {
    const o = owner();
    const id = await printing(o);
    const queue = await getQueue();
    const push = queue.requeue;
    vi.spyOn(queue, 'requeue').mockImplementationOnce(async (owner, job) => {
      await ackJob(owner, job); // the printer's /ack lands here
      return push.call(queue, owner, job);
    });

    expect((await requeueJob(o, id)).requeued).toBe(true);
    expect((await getJob(o, id))?.status).toBe('done');
    expect(waiting(o)).toEqual([id]); // the requeue's push, after the ack

    // The claim finds a finished record: dropped, never served again.
    expect(await nextJob(o)).toBeNull();
    expect(waiting(o)).toEqual([]);
    expect(leased(o)).toEqual([]);
    expect((await getJob(o, id))?.status).toBe('done');
  });

  it('an ack before the requeue refuses it and queues nothing', async () => {
    const o = owner();
    const id = await printing(o);
    await ackJob(o, id);

    expect(await requeueJob(o, id)).toEqual({
      requeued: false,
      status: 'done',
    });
    expect(waiting(o)).toEqual([]);
    expect(await requeueJob(o, 'job-999')).toEqual({
      requeued: false,
      status: null,
    });
  });
});
