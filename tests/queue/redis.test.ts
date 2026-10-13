// tests/queue/redis.test.ts — the hosted queue driver (lib/queue/redis.js)
// against the in-process Redis fake. Only what tests/meter-budget.test.ts
// does not already pin: requeue order (front, or back for a job that keeps
// failing), the attempt counts, withdraw on a leased id, an ack that
// lands after its lease expired, the size the sidebar badge reads, and
// the order the Queue page reads while a job waits at the back.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LEASE_SECONDS } from '@/config.js';
import { getQueue, QUEUE_DRIVER } from '@/lib/queue/index.js';
import {
  calls,
  countPostgres,
  fetchStub,
  hashOf,
  listOf,
  zsetOf,
} from '../helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('../helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/queue-redis`,
  });
});

vi.mock('@upstash/redis', () => import('../helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('../helpers/fake-hosted'));

const T0 = Date.parse('2026-10-12T12:00:00Z');
const LEASE_MS = LEASE_SECONDS * 1000;

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;
const waiting = (o: string) => [...listOf(`rp:${o}:jobs:queue`)];
const leased = (o: string) => [...zsetOf(`rp:${o}:jobs:inflight`).keys()];

describe('redis queue', () => {
  it('is the driver for STORE_DRIVER=redis', async () => {
    expect(QUEUE_DRIVER).toBe('redis');
    expect((await getQueue()).driver).toBe('redis');
  });

  it('requeue puts the id back at the front', async () => {
    const q = await getQueue();
    const o = owner();
    await q.enqueue(o, 'job-1');
    await q.enqueue(o, 'job-2');
    expect(await q.claim(o)).toBe('job-1');

    await q.requeue(o, 'job-1');
    expect(leased(o)).toEqual([]);
    expect(waiting(o)).toEqual(['job-1', 'job-2']);
    expect(await q.claim(o)).toBe('job-1');
  });

  it('requeue to the back puts the id behind every waiting one, and pushes a lost one there too', async () => {
    const q = await getQueue();
    const o = owner();
    await q.enqueue(o, 'job-1');
    await q.enqueue(o, 'job-2');
    expect(await q.claim(o)).toBe('job-1');

    await q.requeue(o, 'job-1', 'back');
    expect(leased(o)).toEqual([]);
    expect(waiting(o)).toEqual(['job-2', 'job-1']);

    // A zombie (in neither structure) goes back where it was asked to.
    await q.requeue(o, 'job-3', 'back');
    expect(waiting(o)).toEqual(['job-2', 'job-1', 'job-3']);
    // Without a lease, a waiting copy moves instead of doubling.
    await q.requeue(o, 'job-3');
    expect(waiting(o)).toEqual(['job-3', 'job-2', 'job-1']);
    await q.requeue(o, 'job-3', 'back');
    expect(waiting(o)).toEqual(['job-2', 'job-1', 'job-3']);
  });

  it('a nack after the lease expired moves the requeued copy to the back', async () => {
    const q = await getQueue();
    const o = owner();
    for (const id of ['job-1', 'job-2', 'job-3']) await q.enqueue(o, id);
    vi.setSystemTime(T0);
    expect(await q.claim(o)).toBe('job-1');
    vi.setSystemTime(T0 + 1_000);
    expect(await q.claim(o)).toBe('job-2');

    // Both leases lapse; the next claim requeues both at the front and
    // takes job-2, leaving job-1 waiting without a lease.
    vi.setSystemTime(T0 + LEASE_MS + 5_000);
    expect(await q.claim(o)).toBe('job-2');
    expect(waiting(o)).toEqual(['job-1', 'job-3']);

    // The printer's late 3rd nack for job-1: one copy, at the back.
    await q.requeue(o, 'job-1', 'back');
    expect(waiting(o)).toEqual(['job-3', 'job-1']);
    expect(leased(o)).toEqual(['job-2']);
  });

  it('counts attempts per id in one hash, lists them, and forgets trimmed ids', async () => {
    const q = await getQueue();
    const o = owner();
    expect(await q.attempts(o)).toEqual({});
    expect(await q.countAttempt(o, 'job-1')).toBe(1);
    expect(await q.countAttempt(o, 'job-1')).toBe(2);
    expect(await q.countAttempt(o, 'job-2')).toBe(1);
    expect(await q.attempts(o)).toEqual({ 'job-1': 2, 'job-2': 1 });
    expect([...hashOf(`rp:${o}:jobs:attempts`).keys()]).toEqual([
      'job-1',
      'job-2',
    ]);

    await q.forget(o, ['job-1', 'job-9']);
    expect(await q.attempts(o)).toEqual({ 'job-2': 1 });
    const sent = calls.length;
    await q.forget(o, []); // nothing trimmed: no command
    expect(calls.length).toBe(sent);
  });

  it('withdraw on a leased id returns leased and keeps the lease', async () => {
    const q = await getQueue();
    const o = owner();
    await q.enqueue(o, 'job-1');
    expect(await q.claim(o)).toBe('job-1');

    expect(await q.withdraw(o, 'job-1')).toBe('leased');
    expect(leased(o)).toEqual(['job-1']);
  });

  it('done after an expired lease removes the requeued copy', async () => {
    const q = await getQueue();
    const o = owner();
    await q.enqueue(o, 'job-1');
    await q.enqueue(o, 'job-2');
    vi.setSystemTime(T0);
    expect(await q.claim(o)).toBe('job-1');
    vi.setSystemTime(T0 + 1_000);
    expect(await q.claim(o)).toBe('job-2');

    // Both leases lapse; the next claim requeues both at the front and
    // takes job-2 again, leaving job-1 waiting as a requeued copy.
    vi.setSystemTime(T0 + LEASE_MS + 5_000);
    expect(await q.claim(o)).toBe('job-2');
    expect(waiting(o)).toEqual(['job-1']);
    expect(leased(o)).toEqual(['job-2']);

    // The printer acks job-1 late: its copy must not print twice.
    await q.done(o, 'job-1');
    expect(waiting(o)).toEqual([]);
    expect(leased(o)).toEqual(['job-2']);
    expect(await q.claim(o)).toBeNull();
  });

  it('size is LLEN plus ZCARD: two commands, no Postgres', async () => {
    await countPostgres();
    const q = await getQueue();
    const o = owner();
    expect(await q.size(o)).toEqual({ queued: 0, inflight: 0 });

    for (const id of ['job-1', 'job-2', 'job-3']) await q.enqueue(o, id);
    expect(await q.claim(o)).toBe('job-1');
    await q.enqueue(owner(), 'job-1'); // someone else's queue

    const from = calls.length;
    expect(await q.size(o)).toEqual({ queued: 2, inflight: 1 });
    expect(calls.slice(from)).toEqual([
      { meter: 'redis', op: 'llen', key: `rp:${o}:jobs:queue` },
      { meter: 'redis', op: 'zcard', key: `rp:${o}:jobs:inflight` },
    ]);
  });

  it('order is one LRANGE: the waiting ids as claims will take them, no Postgres', async () => {
    await countPostgres();
    const q = await getQueue();
    const o = owner();
    expect(await q.order(o)).toEqual([]);
    for (const id of ['job-1', 'job-2', 'job-3']) await q.enqueue(o, id);
    expect(await q.claim(o)).toBe('job-1');
    await q.requeue(o, 'job-1', 'back');
    await q.enqueue(o, 'job-4');

    const from = calls.length;
    expect(await q.order(o)).toEqual(['job-2', 'job-3', 'job-1', 'job-4']);
    expect(calls.slice(from)).toEqual([
      { meter: 'redis', op: 'lrange', key: `rp:${o}:jobs:queue` },
    ]);
  });
});
