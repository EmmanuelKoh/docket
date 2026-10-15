// tests/ingest-hosted.test.ts — /ingest on the hosted stores (fake Redis,
// Blob and a counted PGlite): the ingest token resolves from its kv mirror
// with no Postgres query, a mirror miss asks Postgres once and rewrites
// the mirror, an edited token stops working at once, an unknown token is
// refused from memory for a minute, a token no config could hold is
// refused (401 on the route) with no call at all, and a resent message answers
// { duplicate: true } from Redis alone, the claim being one SET NX EX 90
// and "done" one SET EX 900. The json driver's side of both is in
// tests/kv.test.ts and tests/ops/messages.test.ts.

import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/ingest/route';
import { generateObject } from '@/lib/llm/index.js';
import { userCaller } from '@/lib/ops/caller.js';
import { callerForCredential } from '@/lib/ops/identity.js';
import { slipsSaveConfig } from '@/lib/ops/slips.js';
import {
  findOwnerByCredential,
  getPlugin,
  mirrorCredential,
} from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';
import {
  calls,
  countPostgres,
  expiries,
  fetchStub,
  kv,
} from './helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('./helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/ingest-hosted`,
  });
});

vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('./helpers/fake-hosted'));
vi.mock('@/lib/llm/index.js', () => ({ generateObject: vi.fn() }));

const MODULE = 'message-ingest';
const T0 = Date.parse('2026-10-13T12:00:00Z');

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await countPostgres();
  // No classifier: a "task:" message prints anyway.
  vi.mocked(generateObject).mockRejectedValue(new Error('no classifier'));
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const mirrorKey = (token: string) =>
  `rp:_credentials:${MODULE}:ingestToken:${sha256(token)}`;
const recordKey = (owner: string) => `rp:${owner}:plugin:${MODULE}`;
const resolve = (token: string) =>
  callerForCredential(MODULE, 'ingestToken', token, ['messages.deliver']);

// Metered calls made by fn, as "meter op key", and fn's result.
async function metered<T>(fn: () => Promise<T>) {
  const from = calls.length;
  const result = await fn();
  const log = calls.slice(from).map((c) => `${c.meter} ${c.op} ${c.key}`);
  return { result, log, pg: log.filter((c) => c.startsWith('pg ')) };
}

async function registered() {
  const owner = `owner-${randomUUID()}`;
  await ensureRegistered(owner);
  const token: string = (await getPlugin(owner, MODULE))?.config.ingestToken;
  return { owner, token };
}

describe('ingest token mirror', () => {
  it('registration mirrors the minted token; resolving it reads Redis only', async () => {
    const { owner, token } = await registered();
    expect(JSON.parse(kv.get(mirrorKey(token)) ?? 'null')).toEqual({
      ownerId: owner,
    });

    const { result, log } = await metered(() => resolve(token));
    expect(result?.ownerId).toBe(owner);
    expect(log).toEqual([
      `redis get ${mirrorKey(token)}`,
      `redis get ${recordKey(owner)}`,
    ]);
  });

  it('a mirror miss asks Postgres once and rewrites the mirror', async () => {
    const { owner, token } = await registered();
    kv.delete(mirrorKey(token)); // e.g. a flushed Redis

    const miss = await metered(() => resolve(token));
    expect(miss.result?.ownerId).toBe(owner);
    expect(miss.pg).toEqual(['pg select ']);
    expect(miss.log).toContain(`redis set ${mirrorKey(token)}`);

    const hit = await metered(() => resolve(token));
    expect(hit.result?.ownerId).toBe(owner);
    expect(hit.pg).toEqual([]);
  });

  it('an edited token stops working at once; the new one resolves', async () => {
    const { owner, token } = await registered();
    const fresh = `edited-${randomUUID()}`;
    await slipsSaveConfig(userCaller({ userId: owner, role: 'user' }), {
      id: MODULE,
      config: { ingestToken: fresh },
    });

    // The old entry still points at the owner, whose record now holds the
    // new token: refused, the stale entry dropped, Postgres says no.
    const old = await metered(() => resolve(token));
    expect(old.result).toBeNull();
    expect(kv.has(mirrorKey(token))).toBe(false);
    expect(old.pg).toEqual(['pg select ']);

    expect((await resolve(fresh))?.ownerId).toBe(owner);
    const again = await metered(() => resolve(fresh));
    expect(again.result?.ownerId).toBe(owner);
    expect(again.pg).toEqual([]);
  });

  it('an unknown token is refused and mirrors nothing', async () => {
    const { result, log, pg } = await metered(() => resolve('not-a-token'));
    expect(result).toBeNull();
    expect(pg).toEqual(['pg select ']);
    expect(log.filter((c) => c.startsWith('redis set'))).toEqual([]);
  });

  it('an unknown token is refused from memory for a minute, then asked again', async () => {
    const junk = `junk-${randomUUID()}`;
    try {
      expect((await metered(() => resolve(junk))).pg).toEqual(['pg select ']);
      vi.setSystemTime(T0 + 59_000);
      const cached = await metered(() => resolve(junk));
      expect(cached.result).toBeNull();
      expect(cached.log).toEqual([]); // no Redis, no Postgres
      vi.setSystemTime(T0 + 60_000);
      const again = await metered(() => resolve(junk));
      expect(again.result).toBeNull();
      expect(again.pg).toEqual(['pg select ']);
    } finally {
      vi.setSystemTime(T0);
    }
  });

  it('a token no config could hold costs no Redis or Postgres call', async () => {
    for (const bad of [
      '',
      'has space',
      'tab\there',
      'line\nbreak',
      'café-token',
      'x'.repeat(129),
    ]) {
      const { result, log } = await metered(() => resolve(bad));
      expect(result, JSON.stringify(bad)).toBeNull();
      expect(log, JSON.stringify(bad)).toEqual([]);
    }
    // The longest shape a config can hold is still looked up.
    const longest = `${randomUUID()}${'~'.repeat(92)}`;
    expect(longest).toHaveLength(128);
    expect((await metered(() => resolve(longest))).pg).toEqual(['pg select ']);
  });

  it('remembers at most 1000 unknown tokens, dropping the oldest', async () => {
    // The registry lookup itself: callerForCredential would stop at its
    // per-instance budget (tests/token-flood.test.ts) long before 1000.
    const find = (token: string) =>
      findOwnerByCredential(MODULE, 'ingestToken', token);
    const run = randomUUID();
    const junk = (n: number) => `junk-${run}-${n}`;
    for (let n = 0; n <= 1000; n++) await find(junk(n));
    expect((await metered(() => find(junk(1)))).pg).toEqual([]);
    expect((await metered(() => find(junk(0)))).pg).toEqual(['pg select ']);
  });

  it('a token minted after this instance refused it resolves at once', async () => {
    const { owner } = await registered();
    const typed = `typed-${randomUUID()}`;
    expect(await resolve(typed)).toBeNull(); // sent before it was set
    await slipsSaveConfig(userCaller({ userId: owner, role: 'user' }), {
      id: MODULE,
      config: { ingestToken: typed },
    });
    expect(await resolve(typed)).toBeNull(); // still the refusal in memory
    await mirrorCredential(MODULE, 'ingestToken', typed, owner);
    expect((await resolve(typed))?.ownerId).toBe(owner);
  });
});

describe('POST /ingest duplicate guard (hosted)', () => {
  const ingest = (token: string, body: unknown) =>
    POST(
      new Request('http://docket.test/ingest', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );

  it('a malformed token answers 401 with no store call', async () => {
    const overlong = await metered(() =>
      ingest('x'.repeat(129), { text: 'task: buy stamps' }),
    );
    expect(overlong.result.status).toBe(401);
    expect(overlong.log).toEqual([]);

    const spaced = await metered(() =>
      POST(
        new Request('http://docket.test/ingest?token=a%20b', {
          method: 'POST',
          body: JSON.stringify({ text: 'task: buy stamps' }),
        }),
      ),
    );
    expect(spaced.result.status).toBe(401);
    expect(spaced.log).toEqual([]);
  });

  it('a resent message answers 200 duplicate: true from Redis alone', async () => {
    const { owner, token } = await registered();
    const msg = { text: 'task: buy stamps', sender: 'Alice', source: 'sms' };

    const first = await metered(() => ingest(token, msg));
    expect(first.result.status).toBe(200);
    expect(await first.result.json()).toMatchObject({ task: true, printed: 1 });
    const seen = first.log
      .filter((c) => c.startsWith(`redis set rp:${owner}:seen:${MODULE}:`))
      .map((c) => c.slice('redis set '.length));
    // The claim, then "done" on the same key, expiring 15 minutes out.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    const key = seen[0];
    expect(JSON.parse(kv.get(key) ?? 'null')).toBe('done');
    expect(expiries.get(key)).toBe(T0 + 15 * 60_000);

    const dup = await metered(() => ingest(token, msg));
    expect(dup.result.status).toBe(200);
    expect(await dup.result.json()).toEqual({ duplicate: true });
    expect(dup.pg).toEqual([]);
    expect(dup.log).toEqual([
      `redis get ${mirrorKey(token)}`, // token -> owner
      `redis get ${recordKey(owner)}`, // still this owner's token
      `redis get ${recordKey(owner)}`, // the record delivery runs with
      `redis set ${key}`, // the claim (NX): taken
      `redis get ${key}`, // "done"
    ]);
  });

  it('a claim still pending expires 90 seconds out', async () => {
    const { owner, token } = await registered();
    let finish: (v: unknown) => void = () => {};
    vi.mocked(generateObject).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = ingest(token, { text: 'pick up the dry cleaning' });
    // Real timers (only Date is fake), so the clock stays at T0.
    const claimed = () =>
      [...kv.keys()].find((k) => k.startsWith(`rp:${owner}:seen:`));
    for (let i = 0; i < 400 && !claimed(); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const key = claimed() as string;
    expect(JSON.parse(kv.get(key) ?? 'null')).toBe('pending');
    expect(expiries.get(key)).toBe(T0 + 90_000);
    finish({ is_task: false, confidence: 0.9, tasks: [] });
    expect((await pending).status).toBe(200);
    expect(expiries.get(key)).toBe(T0 + 15 * 60_000);
  });
});
