// tests/job-attempts.test.ts — stuck jobs on the local queue (the
// Postgres driver, attempts and back-of-line places in the json state
// store): a job nacked 3 times waits behind later jobs, a Requeue or a
// cancel clears its place, and a trimmed record drops its count. Then the
// views: jobs.list with attempts, the Queue view model (print order: a
// stuck job behind the jobs queued before its failure, ahead of those
// queued since; "N failed attempts"), the trim order on tied created_at,
// and the shared wording. The hosted queue's side is in
// tests/device-service.test.ts and tests/queue/redis.test.ts.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { failedAttempts } from '@/app/_lib/format';
import { queueData } from '@/app/_lib/queue-data';
import { job } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { createRawJob, getJob } from '@/lib/job-store.js';
import { deviceCaller, userCaller } from '@/lib/ops/caller.js';
import { ack, nack, serveNext } from '@/lib/ops/device-service.js';
import {
  jobsCancel,
  jobsList,
  jobsOrder,
  jobsRequeue,
} from '@/lib/ops/jobs.js';
import { getQueue } from '@/lib/queue/index.js';
import { getState } from '@/lib/state-store.js';

// JOB_CAP 3 so a few jobs exercise the trim.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/job-attempts`;
  process.env.JOB_CAP = '3';
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const raw = (name: string) => ({
  name,
  source: 'test',
  bytes: Buffer.from([0x1b, 0x40, 0x0a]),
  png: Buffer.from('png'),
  width: 576,
  height: 1,
});

function owner() {
  const id = `owner-${randomUUID()}`;
  return {
    id,
    device: deviceCaller({ ownerId: id, deviceId: `dev-${id}`, owners: [id] }),
    user: userCaller({ userId: id, role: 'user' }),
  };
}
type Owner = ReturnType<typeof owner>;

const served = async (o: Owner) => {
  const ref = (await serveNext(o.device))?.jobRef;
  return ref ? ref.slice(ref.indexOf('~') + 1) : null;
};
const nackIt = (o: Owner, id: string) => nack(o.device, `${o.id}~${id}`);
const line = async (o: Owner) => (await getState(o.id, 'queue')) ?? {};

describe('a job that keeps failing, local queue', () => {
  it('retries at the front twice, then waits behind every job queued before its 3rd nack', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    const b = (await createRawJob(o.id, raw('b'))).id;

    for (let n = 1; n <= 2; n++) {
      expect(await served(o)).toBe(a);
      await nackIt(o, a);
    }
    expect(await served(o)).toBe(a);
    await nackIt(o, a); // 3rd
    const c = (await createRawJob(o.id, raw('c'))).id; // queued after it

    expect(await served(o)).toBe(b);
    await ack(o.device, `${o.id}~${b}`);
    expect(await served(o)).toBe(a);
    expect((await line(o)).back).toEqual({}); // claimed: its place is spent
    await nackIt(o, a); // 4th: behind c now
    expect(await served(o)).toBe(c);
    expect(await served(o)).toBe(a);
    expect(await served(o)).toBeNull();
    expect((await queueAttempts(o))[a]).toBe(4);
  });

  it('a Requeue brings a waiting job back to its place; a cancel clears its place', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    const b = (await createRawJob(o.id, raw('b'))).id;
    for (let n = 1; n <= 3; n++) {
      expect(await served(o)).toBe(a);
      await nackIt(o, a);
    }
    expect(Object.keys((await line(o)).back)).toEqual([a]); // behind b

    expect(await jobsRequeue(o.user, { id: a })).toEqual({ requeued: true });
    expect((await line(o)).back).toEqual({});
    expect(await served(o)).toBe(a); // created first, so first again

    await nackIt(o, a); // 4th: to the back
    expect(await jobsCancel(o.user, { id: a })).toEqual({ canceled: true });
    expect((await line(o)).back).toEqual({});
    expect(await served(o)).toBe(b);
    // The count stays with the record, for History.
    expect((await queueAttempts(o))[a]).toBe(4);
  });

  it('drops the count when the record is trimmed', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    expect(await served(o)).toBe(a);
    await nackIt(o, a);
    expect(await served(o)).toBe(a);
    await ack(o.device, `${o.id}~${a}`);
    expect(await queueAttempts(o)).toEqual({ [a]: 1 });

    // JOB_CAP 3: the 4th job trims the oldest done record, a.
    for (const name of ['b', 'c', 'd']) await createRawJob(o.id, raw(name));
    expect(await getJob(o.id, a)).toBeNull();
    expect(await queueAttempts(o)).toEqual({});
  });
});

async function queueAttempts(o: Owner) {
  return (await getQueue()).attempts(o.id);
}

describe('views', () => {
  it('jobs.list carries attempts only when asked', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    expect(await served(o)).toBe(a);
    await nackIt(o, a);
    await nackIt(o, a); // a repeat nack still counts

    const [withCounts] = await jobsList(o.user, { attempts: true });
    expect(withCounts).toMatchObject({ id: a, attempts: 2 });
    const [plain] = await jobsList(o.user);
    expect(plain).not.toHaveProperty('attempts');
  });

  it('the Queue view lists a stuck job behind the jobs queued before its failure, and says how often it failed', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    const b = (await createRawJob(o.id, raw('b'))).id;
    const c = (await createRawJob(o.id, raw('c'))).id;
    for (let n = 1; n <= 3; n++) {
      expect(await served(o)).toBe(a);
      await nackIt(o, a);
    }
    expect(await served(o)).toBe(b); // printing now

    const { jobs, count } = await queueData(o.user);
    expect(count).toBe(3);
    expect(jobs.map((j) => [j.id, j.statusText, j.attemptsText])).toEqual([
      [b, 'printing', ''],
      [c, 'queued', ''],
      [a, 'queued', '3 failed attempts'],
    ]);
  });

  it('the Queue view lists a stuck job ahead of jobs queued after its failure, where it will print', async () => {
    const o = owner();
    const a = (await createRawJob(o.id, raw('a'))).id;
    const b = (await createRawJob(o.id, raw('b'))).id;
    for (let n = 1; n <= 3; n++) {
      expect(await served(o)).toBe(a);
      await nackIt(o, a);
    }
    const c = (await createRawJob(o.id, raw('c'))).id; // after the 3rd nack

    const order = vi.spyOn(await getQueue(), 'order');
    try {
      const listed = async () =>
        (await queueData(o.user)).jobs.map((j) => j.id);
      expect(await listed()).toEqual([b, a, c]);
      expect(order).toHaveBeenCalledTimes(1);
      // The order the printer takes them.
      expect(await served(o)).toBe(b);
      expect(await listed()).toEqual([b, a, c]); // b printing
      await ack(o.device, `${o.id}~${b}`);
      expect(await served(o)).toBe(a);
      expect(await served(o)).toBe(c);

      // With no job at the back, the view reads no queue order.
      order.mockClear();
      const fresh = owner();
      await createRawJob(fresh.id, raw('x'));
      await createRawJob(fresh.id, raw('y'));
      expect(await served(fresh)).toBeTruthy();
      expect((await queueData(fresh.user)).jobs).toHaveLength(2);
      expect(order).not.toHaveBeenCalled();
    } finally {
      order.mockRestore();
    }
    expect(await jobsOrder(o.user)).toEqual({ ids: [] });
  });

  it('trims the oldest finished record first, by sequence when created_at ties (job-9 before job-10)', async () => {
    const o = owner();
    const db = await getDb();
    const at = new Date(Date.now() - 60_000);
    // Written job-10 first, so neither storage order nor text order
    // picks job-9.
    for (const id of ['job-10', 'job-9', 'job-8']) {
      await db.insert(job).values({
        ownerId: o.id,
        id,
        status: id === 'job-8' ? 'queued' : 'done',
        createdAt: at,
        bytes: Buffer.from([0x1b, 0x40]).toString('base64'),
      });
    }
    // JOB_CAP 3: the 4th record trims one finished record.
    await createRawJob(o.id, raw('new'));
    expect(await getJob(o.id, 'job-9')).toBeNull();
    expect(await getJob(o.id, 'job-10')).not.toBeNull();
  });

  it('words the count for Queue and History', () => {
    expect(failedAttempts(0)).toBe('');
    expect(failedAttempts(undefined)).toBe('');
    expect(failedAttempts(1)).toBe('1 failed attempt');
    expect(failedAttempts(3)).toBe('3 failed attempts');
  });
});
