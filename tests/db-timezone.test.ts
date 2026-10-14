// tests/db-timezone.test.ts — local PGlite stores now() defaults in UTC on
// a machine that is not on UTC. The timestamp columns have no time zone
// and drizzle reads them as UTC, so lib/db.js pins the session zone; before
// that, a job's created_at here came back 8 hours ahead. CI runs on UTC,
// so this file moves the process to Asia/Singapore before PGlite loads.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db.js';
import { createRawJob, listJobs } from '@/lib/job-store.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/db-timezone`;
  process.env.TZ = 'Asia/Singapore';
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const raw = {
  name: 'raw',
  source: 'test',
  bytes: Buffer.from([0x1b, 0x40, 0x0a]),
  png: Buffer.from('png'),
  width: 576,
  height: 1,
};

describe('PGlite session time zone', () => {
  it('runs this file off UTC', () => {
    // Without this, the checks below would pass on a UTC machine
    // whether or not lib/db.js pins the zone.
    expect(new Date().getTimezoneOffset()).toBe(-480);
  });

  it("stores a job's created_at default as the current UTC time", async () => {
    const before = Date.now();
    const { id } = await createRawJob('tz-owner', raw);
    const after = Date.now();
    const [row] = await listJobs('tz-owner');
    expect(row.id).toBe(id);
    const created = Date.parse(row.createdAt);
    expect(created).toBeGreaterThanOrEqual(before - 1_000);
    expect(created).toBeLessThanOrEqual(after + 1_000);
  });

  it('compares now() with JS-written timestamps on the same clock', async () => {
    const db = await getDb();
    // A JS Date is written as its UTC wall time; an hour ahead must
    // still be ahead of now(), not 7 hours behind it.
    const hourAhead = new Date(Date.now() + 3600_000).toISOString();
    const res = await db.execute(
      sql`select ${hourAhead}::timestamp > now() as ahead`,
    );
    const rows = (res as { rows?: Array<{ ahead: boolean }> }).rows ?? res;
    expect((rows as Array<{ ahead: boolean }>)[0].ahead).toBe(true);
  });
});
