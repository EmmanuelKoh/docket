// Guards the test harness itself: if any of these fail, other tests could
// be reading or writing a developer's data/ or a cloud store.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as config from '@/config.js';
import { getDb } from '@/lib/db.js';

describe('test isolation', () => {
  it('never points at a cloud database or store', () => {
    expect(config.DATABASE_URL).toBe('');
    expect(config.STORE_DRIVER).toBe('json');
    expect(process.env.UPSTASH_REDIS_REST_URL).toBe('');
    expect(process.env.KV_REST_API_URL).toBe('');
    expect(process.env.BLOB_READ_WRITE_TOKEN).toBe('');
  });

  it('keeps local state out of the repo data/ folder', () => {
    const repoData = path.resolve('data');
    expect(path.resolve(config.DATA_DIR)).not.toBe(repoData);
    expect(config.PGLITE_DIR).toBe('memory://');
  });

  it('runs migrations on an in-memory PGlite', async () => {
    const db = await getDb();
    const res = await db.execute('select count(*)::int as n from "job"');
    expect(res.rows[0]).toEqual({ n: 0 });
  });
});
