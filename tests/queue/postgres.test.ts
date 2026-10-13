// tests/queue/postgres.test.ts — the local queue driver (lib/queue/postgres.js):
// the job table is the queue, status 'queued' rows oldest first and
// 'inflight' as the lease; its order is the claim's; its size is a count
// of those rows. listJobs orders same-millisecond rows by job sequence.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { job } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { createRawJob, listJobs } from '@/lib/job-store.js';
import { getQueue, QUEUE_DRIVER } from '@/lib/queue/index.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/queue-postgres`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;

// A bare job row with an explicit age, so claim order is checked against
// created_at rather than insertion order.
async function insertJob(
  ownerId: string,
  id: string,
  status: string,
  createdAt: Date,
) {
  const db = await getDb();
  await db.insert(job).values({
    ownerId,
    id,
    status,
    createdAt,
    bytes: Buffer.from([0x1b, 0x40]).toString('base64'),
  });
}

const raw = {
  name: 'raw',
  source: 'test',
  bytes: Buffer.from([0x1b, 0x40, 0x0a]),
  png: Buffer.from('png'),
  width: 576,
  height: 1,
};

describe('postgres queue', () => {
  it('is the driver for STORE_DRIVER=json', async () => {
    expect(QUEUE_DRIVER).toBe('postgres');
    expect((await getQueue()).driver).toBe('postgres');
    expect(await (await getQueue()).hint(owner())).toBeNull();
  });

  it('mintId counts up from the highest job-N the owner has', async () => {
    const q = await getQueue();
    const o = owner();
    expect(await q.mintId(o)).toBe('job-1');
    expect((await createRawJob(o, raw)).id).toBe('job-1');
    expect((await createRawJob(o, raw)).id).toBe('job-2');
    expect(await q.mintId(o)).toBe('job-3');

    // The highest number wins, not the row count; other ids are ignored.
    await insertJob(o, 'job-10', 'done', new Date());
    await insertJob(o, 'imported', 'done', new Date());
    expect(await q.mintId(o)).toBe('job-11');
    // Another owner's ids are their own.
    expect(await q.mintId(owner())).toBe('job-1');
  });

  it("claims the oldest queued row first, leases it, and skips other owners' rows", async () => {
    const q = await getQueue();
    const o = owner();
    const other = owner();
    const t = Date.parse('2026-10-12T12:00:00Z');
    await insertJob(o, 'job-1', 'queued', new Date(t + 2_000));
    await insertJob(o, 'job-2', 'queued', new Date(t));
    await insertJob(o, 'job-3', 'done', new Date(t - 5_000));
    await insertJob(o, 'job-4', 'queued', new Date(t + 1_000));
    await insertJob(other, 'job-1', 'queued', new Date(t - 9_000));

    expect(await q.claim(o)).toBe('job-2');
    expect(await q.claim(o)).toBe('job-4');
    expect(await q.claim(o)).toBe('job-1');
    expect(await q.claim(o)).toBeNull();

    const db = await getDb();
    const rows = await db.select().from(job);
    const mine = rows.filter((r) => r.ownerId === o && r.status === 'inflight');
    expect(mine.map((r) => r.id).sort()).toEqual(['job-1', 'job-2', 'job-4']);
    expect(mine.every((r) => r.claimedAt instanceof Date)).toBe(true);
    expect(rows.find((r) => r.ownerId === other)?.status).toBe('queued');
  });

  it('withdraw: removed while queued, leased once claimed, absent otherwise', async () => {
    const q = await getQueue();
    const o = owner();
    const t = Date.now();
    await insertJob(o, 'job-1', 'queued', new Date(t));
    await insertJob(o, 'job-2', 'queued', new Date(t + 1_000));
    await insertJob(o, 'job-3', 'done', new Date(t));
    await insertJob(o, 'job-4', 'canceled', new Date(t));

    expect(await q.claim(o)).toBe('job-1');
    expect(await q.withdraw(o, 'job-1')).toBe('leased');
    expect(await q.withdraw(o, 'job-2')).toBe('removed');
    expect(await q.withdraw(o, 'job-3')).toBe('absent');
    expect(await q.withdraw(o, 'job-4')).toBe('absent');
    expect(await q.withdraw(o, 'job-99')).toBe('absent');
    expect(await q.withdraw(owner(), 'job-2')).toBe('absent');
  });

  it('listJobs keeps only the given statuses, and none for an empty list', async () => {
    const o = owner();
    const t = Date.now();
    await insertJob(o, 'job-1', 'queued', new Date(t));
    await insertJob(o, 'job-2', 'inflight', new Date(t + 1_000));
    await insertJob(o, 'job-3', 'done', new Date(t + 2_000));
    await insertJob(o, 'job-4', 'canceled', new Date(t + 3_000));
    await insertJob(owner(), 'job-5', 'queued', new Date(t + 4_000));

    const open = await listJobs(o, 20, { status: ['queued', 'inflight'] });
    expect(open.map((j) => [j.id, j.status])).toEqual([
      ['job-2', 'inflight'],
      ['job-1', 'queued'],
    ]);
    expect(await listJobs(o, 20, { status: [] })).toEqual([]);
    expect((await listJobs(o)).map((j) => j.id)).toEqual([
      'job-4',
      'job-3',
      'job-2',
      'job-1',
    ]);
  });

  it('listJobs breaks created_at ties by job sequence, newest first (job-10 before job-9)', async () => {
    const o = owner();
    const at = new Date(Date.now() - 60_000);
    for (let n = 1; n <= 11; n++) await insertJob(o, `job-${n}`, 'done', at);
    const ids = Array.from({ length: 11 }, (_, i) => `job-${11 - i}`);
    expect((await listJobs(o)).map((j) => j.id)).toEqual(ids);
    expect((await listJobs(o, 3)).map((j) => j.id)).toEqual(ids.slice(0, 3));
  });

  it('order gives the waiting ids as claims will take them, back-of-line places included', async () => {
    const q = await getQueue();
    const o = owner();
    const t = Date.now();
    await insertJob(o, 'job-1', 'queued', new Date(t));
    await insertJob(o, 'job-2', 'queued', new Date(t + 1_000));
    await insertJob(o, 'job-3', 'inflight', new Date(t + 2_000));
    await insertJob(o, 'job-4', 'queued', new Date(t + 3_000));
    expect(await q.order(o)).toEqual(['job-1', 'job-2', 'job-4']);

    // Sent to the back: behind every job created up to now, ahead of
    // any created later.
    await q.requeue(o, 'job-1', 'back');
    await insertJob(o, 'job-5', 'queued', new Date(t + 4_000));
    expect(await q.order(o)).toEqual(['job-2', 'job-4', 'job-1', 'job-5']);
    for (const id of ['job-2', 'job-4', 'job-1', 'job-5']) {
      expect(await q.claim(o)).toBe(id);
    }
    expect(await q.order(o)).toEqual([]);
  });

  it("size counts the owner's queued and inflight rows only", async () => {
    const q = await getQueue();
    const o = owner();
    expect(await q.size(o)).toEqual({ queued: 0, inflight: 0 });
    const t = Date.now();
    await insertJob(o, 'job-1', 'queued', new Date(t));
    await insertJob(o, 'job-2', 'queued', new Date(t + 1_000));
    await insertJob(o, 'job-3', 'inflight', new Date(t + 2_000));
    for (const status of ['done', 'failed', 'canceled']) {
      await insertJob(o, `job-${status}`, status, new Date(t));
    }
    await insertJob(owner(), 'job-1', 'queued', new Date(t));

    expect(await q.size(o)).toEqual({ queued: 2, inflight: 1 });
  });
});
