// tests/token-flood.test.ts — a flood of well-shaped but unknown tokens
// cannot buy unlimited Redis and Postgres reads. Each warm instance looks
// up at most 30 tokens a minute that no memory cache knows, per kind
// (lib/ops/identity.js). Past that, device endpoints answer 503 with
// Retry-After, never 401 (ten 401s wipe a printer's token), and /ingest
// answers 429 with Retry-After. A token that has resolved on the instance
// is never limited, even after its cache entry expires, and the budget
// refills after the minute.

import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as ackRoute } from '@/app/ack/route.ts';
import { POST as ingestRoute } from '@/app/ingest/route';
import { POST as nackRoute } from '@/app/nack/route.ts';
import { GET as nextRoute } from '@/app/next/route.ts';
import { POST as pairRoute } from '@/app/pair/route.ts';
import { POST as tickRoute } from '@/app/tick/route.ts';
import { claimDevice } from '@/lib/devices.js';
import { UNKNOWN_LOOKUPS_PER_MINUTE } from '@/lib/ops/identity.js';
import { getPlugin } from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/token-flood`;
});

afterEach(() => {
  vi.useRealTimers();
});

const BASE = 'http://docket.test';
const minted = () => crypto.randomBytes(32).toString('base64url');
const owner = () => `owner-${crypto.randomUUID()}`;

const device = (method: 'GET' | 'POST', path: string, token: string) =>
  new Request(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: method === 'POST' ? '' : undefined,
  });
const next = (t: string) => nextRoute(device('GET', '/next', t));
const tick = (t: string) => tickRoute(device('POST', '/tick', t));
const ack = (t: string) => ackRoute(device('POST', '/ack?job=job-1', t));
const nack = (t: string) => nackRoute(device('POST', '/nack?job=job-1', t));

let ip = 0;
async function pairDevice(ownerId: string) {
  const hardwareId = `esp32-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const pair = (body: unknown) =>
    pairRoute(
      new Request(`${BASE}/pair`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${++ip}`,
        },
        body: JSON.stringify(body),
      }),
    );
  const { code } = await (await pair({ hardwareId })).json();
  if (!(await claimDevice(ownerId, code, 'printer'))) throw new Error('claim');
  const { token } = await (await pair({ hardwareId, code })).json();
  return token as string;
}

const later = (ms: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
};

// Past the 5-minute memory cache of lib/devices.js, and past the
// 5-minute window ingest tokens used to be exempt for.
const PAST_CACHE_MS = 5 * 60_000 + 1_000;

describe('device endpoints under an unknown-token flood', () => {
  it('answer 401 until the budget is spent, then 503 with Retry-After; cached tokens keep working', async () => {
    const cached = await pairDevice(owner());
    expect((await next(cached)).status).toBe(204); // one lookup, now cached
    const fresh = await pairDevice(owner()); // known, but not cached here

    const junk = Array.from({ length: UNKNOWN_LOOKUPS_PER_MINUTE + 5 }, minted);
    const statuses: number[] = [];
    let busy: Response | undefined;
    for (const t of junk) {
      const res = await next(t);
      statuses.push(res.status);
      if (res.status === 503) busy ??= res;
    }
    expect(statuses.slice(0, UNKNOWN_LOOKUPS_PER_MINUTE - 1)).toEqual(
      Array(UNKNOWN_LOOKUPS_PER_MINUTE - 1).fill(401),
    );
    expect(statuses.slice(UNKNOWN_LOOKUPS_PER_MINUTE - 1)).toEqual(
      Array(6).fill(503),
    );
    const retryAfter = Number(busy?.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await busy?.json()).toEqual({
      error: 'too many unknown tokens; retry later',
    });

    // Every device endpoint: 503, never 401, for a new unknown token.
    for (const call of [next, tick, ack, nack]) {
      expect((await call(minted())).status).toBe(503);
    }
    // A token already refused is refused from memory: still 401.
    expect((await next(junk[0])).status).toBe(401);
    // Not minted-shaped: refused before any lookup, still 401.
    expect((await next('not-a-real-token')).status).toBe(401);

    // The cached device is never limited.
    expect((await next(cached)).status).toBe(204);
    expect((await tick(cached)).status).toBe(200);
    // A real device this instance has not cached waits, without a 401.
    expect((await next(fresh)).status).toBe(503);

    // The budget refills after the minute.
    later(61_000);
    expect((await next(fresh)).status).toBe(204);
  });

  it('never refuse a printer this instance has resolved, after its cache entry expires', async () => {
    const printer = await pairDevice(owner());
    expect((await next(printer)).status).toBe(204); // resolved here once
    later(PAST_CACHE_MS); // its cache entry is now stale

    const flood: number[] = [];
    for (let i = 0; i < 100; i++) flood.push((await next(minted())).status);
    expect(new Set(flood)).toEqual(new Set([401, 503]));
    expect(flood.at(-1)).toBe(503); // the budget is spent

    // A fresh lookup for the printer, while the budget is spent.
    const replies = [await next(printer), await tick(printer)];
    expect(replies.map((r) => r.status)).toEqual([204, 200]);

    // And again once that entry is stale, mid-flood.
    later(PAST_CACHE_MS);
    for (let i = 0; i < 40; i++) {
      const status = (await next(minted())).status;
      expect([401, 503]).toContain(status);
      if (i % 10 === 9) {
        expect((await next(printer)).status).toBe(204);
        expect((await tick(printer)).status).toBe(200);
      }
    }
  });
});

describe('/ingest under an unknown-token flood', () => {
  const ingest = (token: string) =>
    ingestRoute(
      new Request(`${BASE}/ingest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: '' }),
      }),
    );
  const ingestToken = async () => {
    const o = owner();
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await ensureRegistered(o);
    quiet.mockRestore();
    return (await getPlugin(o, 'message-ingest'))?.config.ingestToken as string;
  };

  it('answers 401 until the budget is spent, then 429 with Retry-After; known senders keep working', async () => {
    const known = await ingestToken();
    expect((await ingest(known)).status).toBe(200); // { skipped: 'empty' }
    const unseen = await ingestToken();

    const statuses: number[] = [];
    let busy: Response | undefined;
    for (let i = 0; i < UNKNOWN_LOOKUPS_PER_MINUTE + 5; i++) {
      const res = await ingest(`junk-${crypto.randomUUID()}`);
      statuses.push(res.status);
      if (res.status === 429) busy ??= res;
    }
    expect(statuses.slice(0, UNKNOWN_LOOKUPS_PER_MINUTE - 1)).toEqual(
      Array(UNKNOWN_LOOKUPS_PER_MINUTE - 1).fill(401),
    );
    expect(statuses.slice(UNKNOWN_LOOKUPS_PER_MINUTE - 1)).toEqual(
      Array(6).fill(429),
    );
    expect(Number(busy?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

    // A sender this instance already resolved is not limited.
    expect((await ingest(known)).status).toBe(200);
    // One it has not seen waits for the budget.
    expect((await ingest(unseen)).status).toBe(429);
    later(61_000);
    expect((await ingest(unseen)).status).toBe(200);
  });

  it('never refuses a sender this instance has resolved, however long ago', async () => {
    const sender = await ingestToken();
    expect((await ingest(sender)).status).toBe(200);
    later(PAST_CACHE_MS);

    const flood: number[] = [];
    for (let i = 0; i < 100; i++) {
      flood.push((await ingest(`junk-${crypto.randomUUID()}`)).status);
    }
    expect(new Set(flood)).toEqual(new Set([401, 429]));
    expect(flood.at(-1)).toBe(429);
    expect((await ingest(sender)).status).toBe(200);
  });
});
