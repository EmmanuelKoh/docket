// tests/kv.test.ts — lib/kv.js on the json driver (data/kv.json): a claim
// writes only when the name is absent, a value expires after its TTL (and
// can be claimed again), a value without a TTL stays, del removes, and
// scopes keep the same name apart. The Redis driver's commands are in
// tests/ingest-hosted.test.ts.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DATA_DIR } from '@/config.js';
import * as kv from '@/lib/kv.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/kv`;
});

const T0 = Date.parse('2026-10-13T12:00:00Z');

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.setSystemTime(T0);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const scope = () => `owner-${randomUUID()}`;

describe('lib/kv.js (json driver)', () => {
  it('claims a name only while it is absent', async () => {
    const s = scope();
    expect(await kv.claim(s, 'seen:x', 'pending', 60)).toBe(true);
    expect(await kv.claim(s, 'seen:x', 'other', 60)).toBe(false);
    expect(await kv.get(s, 'seen:x')).toBe('pending');
  });

  it('expires a value after its TTL; the name can then be claimed again', async () => {
    const s = scope();
    await kv.claim(s, 'seen:y', 'pending', 900);
    vi.setSystemTime(T0 + 899_000);
    expect(await kv.get(s, 'seen:y')).toBe('pending');
    expect(await kv.claim(s, 'seen:y', 'pending', 900)).toBe(false);

    vi.setSystemTime(T0 + 900_000);
    expect(await kv.get(s, 'seen:y')).toBeNull();
    expect(await kv.claim(s, 'seen:y', 'again', 900)).toBe(true);
    expect(await kv.get(s, 'seen:y')).toBe('again');
  });

  it('set overwrites and restarts the TTL; without one the value stays', async () => {
    const s = scope();
    await kv.claim(s, 'a', 'pending', 60);
    vi.setSystemTime(T0 + 50_000);
    await kv.set(s, 'a', 'done', { ttlSeconds: 60 });
    vi.setSystemTime(T0 + 100_000);
    expect(await kv.get(s, 'a')).toBe('done');

    await kv.set(s, 'mirror', { ownerId: 'o-1' });
    vi.setSystemTime(T0 + 365 * 86_400_000);
    expect(await kv.get(s, 'mirror')).toEqual({ ownerId: 'o-1' });
  });

  it('del removes a value; scopes keep the same name apart', async () => {
    const a = scope();
    const b = scope();
    await kv.set(a, 'n', 1);
    await kv.set(b, 'n', 2);
    await kv.del(a, 'n');
    expect(await kv.get(a, 'n')).toBeNull();
    expect(await kv.get(b, 'n')).toBe(2);
    expect(await kv.claim(a, 'n', 3, 60)).toBe(true);
  });

  it('drops expired entries from data/kv.json on the next write', async () => {
    const s = scope();
    await kv.claim(s, 'short', 'pending', 1);
    vi.setSystemTime(T0 + 2_000);
    await kv.set(s, 'other', 'x');
    const file = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'kv.json'), 'utf8'),
    );
    expect(file[`${s}:short`]).toBeUndefined();
    expect(file[`${s}:other`]).toEqual({ value: 'x', expiresAt: null });
  });
});
