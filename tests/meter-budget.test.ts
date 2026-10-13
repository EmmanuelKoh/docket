// tests/meter-budget.test.ts — what the device cadence costs in hosted
// mode (STORE_DRIVER=redis), in metered store calls per request. The ESP32
// polls /next every 5s and /tick every 30s forever, so one extra Redis
// command or Postgres query on the idle path multiplies into the monthly
// bill (docs/store-costs.md has the quota math). A change that adds one
// fails here.
//
// Every metered service is faked in-process and counted:
//   Redis     @upstash/redis replaced by an in-memory client that logs
//             every command (including both claim Lua scripts, run in JS)
//   Blob      @vercel/blob put/del write an in-memory map; global fetch
//             serves that map (flag and artifact reads) and throws for
//             any other URL
//   Postgres  the real in-memory PGlite, wrapped in a Proxy that logs
//             each query-building entry point

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ---- fakes (hoisted above the module mocks that use them) ----

const fake = vi.hoisted(() => {
  const BLOB_STORE_ID = 'meterteststore';
  const BLOB_HOST = `${BLOB_STORE_ID}.public.blob.vercel-storage.com`;
  // lib/change-signal.js derives flag URLs from this token shape:
  // vercel_blob_rw_{storeId}_{secret}.
  const BLOB_TOKEN = `vercel_blob_rw_${BLOB_STORE_ID}_notarealsecret`;

  // One ordered log for every metered call, so a test can check both how
  // many and in what order (Postgres only after a successful claim).
  type Call = {
    meter: 'redis' | 'pg' | 'blob-write' | 'blob-read' | 'network';
    op: string;
    key: string;
  };
  const calls: Call[] = [];

  // ---- Redis ----

  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();
  const redisClients: string[] = [];

  const listOf = (key: string) => {
    let l = lists.get(key);
    if (!l) {
      l = [];
      lists.set(key, l);
    }
    return l;
  };
  const zsetOf = (key: string) => {
    let z = zsets.get(key);
    if (!z) {
      z = new Map();
      zsets.set(key, z);
    }
    return z;
  };
  const setOf = (key: string) => {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  };
  const sortedZ = (key: string) =>
    [...zsetOf(key).entries()].sort(
      (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1),
    );
  // @upstash/redis JSON-encodes values on write and decodes on read.
  const decode = (raw: string | undefined) => {
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  // Recognize the two Lua scripts by a line unique to each.
  const JOB_CLAIM_MARK = "redis.call('LPOP', KEYS[1])"; // lib/job-store.js CLAIM_LUA
  const DUE_CLAIM_MARK = "'LIMIT', 0, 20"; // lib/stores/plugins-redis.js CLAIM_DUE_LUA

  // CLAIM_LUA: requeue expired leases at the front, pop the next id, lease it.
  function claimJob(keys: string[], args: (string | number)[]) {
    const [queueKey, inflightKey] = keys;
    const now = Number(args[0]);
    const lease = Number(args[1]);
    const inflight = zsetOf(inflightKey);
    for (const [id, score] of sortedZ(inflightKey)) {
      if (score > now) continue;
      inflight.delete(id);
      listOf(queueKey).unshift(id);
    }
    const id = listOf(queueKey).shift();
    if (id === undefined) return null;
    inflight.set(id, now + lease);
    return id;
  }

  // CLAIM_DUE_LUA: up to 20 ids due at `now`, each re-scored to now + lease.
  function claimDue(keys: string[], args: (string | number)[]) {
    const now = Number(args[0]);
    const lease = Number(args[1]);
    const due = sortedZ(keys[0])
      .filter(([, score]) => score <= now)
      .slice(0, 20)
      .map(([id]) => id);
    for (const id of due) zsetOf(keys[0]).set(id, now + lease);
    return due;
  }

  const commands = {
    async get(key: string) {
      return decode(kv.get(key));
    },
    async set(key: string, value: unknown) {
      kv.set(key, JSON.stringify(value));
      return 'OK';
    },
    async del(...keys: string[]) {
      return keys.filter((k) => kv.delete(k)).length;
    },
    async mget(...keys: string[]) {
      return keys.map((k) => decode(kv.get(k)));
    },
    async incr(key: string) {
      const n = Number(kv.get(key) ?? 0) + 1;
      kv.set(key, String(n));
      return n;
    },
    async rpush(key: string, ...values: string[]) {
      const l = listOf(key);
      l.push(...values);
      return l.length;
    },
    async lpush(key: string, ...values: string[]) {
      const l = listOf(key);
      for (const v of values) l.unshift(v);
      return l.length;
    },
    async lrem(key: string, count: number, value: string) {
      const l = listOf(key);
      let removed = 0;
      for (let i = 0; i < l.length && (count <= 0 || removed < count); ) {
        if (l[i] === value) {
          l.splice(i, 1);
          removed++;
        } else i++;
      }
      return removed;
    },
    async lpos(key: string, value: string) {
      const i = listOf(key).indexOf(value);
      return i < 0 ? null : i;
    },
    async zadd(key: string, ...entries: { score: number; member: string }[]) {
      const z = zsetOf(key);
      let added = 0;
      for (const { score, member } of entries) {
        if (!z.has(member)) added++;
        z.set(member, Number(score));
      }
      return added;
    },
    async zrem(key: string, ...members: string[]) {
      const z = zsetOf(key);
      return members.filter((m) => z.delete(m)).length;
    },
    async zscore(key: string, member: string) {
      return zsetOf(key).get(member) ?? null;
    },
    async zrange(
      key: string,
      start: number,
      stop: number,
      opts?: { withScores?: boolean },
    ) {
      const sorted = sortedZ(key);
      const end = stop < 0 ? sorted.length + stop : stop;
      const slice = sorted.slice(start, end + 1);
      return opts?.withScores ? slice.flat() : slice.map(([m]) => m);
    },
    async sadd(key: string, ...members: string[]) {
      const s = setOf(key);
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) added++;
        s.add(m);
      }
      return added;
    },
    async smembers(key: string) {
      return [...setOf(key)];
    },
    async eval(script: string, keys: string[], args: (string | number)[]) {
      if (script.includes(JOB_CLAIM_MARK)) return claimJob(keys, args);
      if (script.includes(DUE_CLAIM_MARK)) return claimDue(keys, args);
      throw new Error('fake Redis: unknown Lua script');
    },
  };

  // `new Redis({url, token})` returns a client whose every method call is
  // one logged command. An unimplemented command is still logged, then
  // rejects, so a new command on these paths fails loudly.
  function Redis(opts: { url: string; token: string }) {
    redisClients.push(opts.url);
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          return (...args: unknown[]) => {
            const key =
              prop === 'eval'
                ? String((args[1] as string[])[0])
                : String(args[0]);
            calls.push({ meter: 'redis', op: prop, key });
            const impl = (commands as Record<string, unknown>)[prop];
            if (typeof impl !== 'function') {
              return Promise.reject(
                new Error(`fake Redis: ${prop} is not implemented`),
              );
            }
            return (impl as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        },
      },
    );
  }

  // ---- Blob ----

  const blobs = new Map<string, Uint8Array>();
  let suffix = 0;

  async function put(
    pathname: string,
    body: string | Uint8Array,
    opts: { addRandomSuffix?: boolean } = {},
  ) {
    const stored = opts.addRandomSuffix
      ? pathname.replace(/(\.[^./]*)?$/, `-r${++suffix}$1`)
      : pathname;
    blobs.set(
      stored,
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : new Uint8Array(body),
    );
    calls.push({ meter: 'blob-write', op: 'put', key: stored });
    return { url: `https://${BLOB_HOST}/${stored}`, pathname: stored };
  }

  async function del(urls: string | string[]) {
    for (const u of [urls].flat()) {
      const stored = new URL(u).pathname.slice(1);
      calls.push({ meter: 'blob-write', op: 'del', key: stored });
      blobs.delete(stored);
    }
  }

  // Stand-in for global fetch: serves the blob map, refuses the network.
  async function fetchStub(input: string | URL | Request) {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href);
    if (url.hostname !== BLOB_HOST) {
      calls.push({ meter: 'network', op: 'fetch', key: href });
      throw new Error(`test blocked a network fetch: ${href}`);
    }
    const stored = decodeURIComponent(url.pathname.slice(1));
    const isFlag =
      stored.startsWith('queue-flag/') || stored.startsWith('tick-flag/');
    calls.push({
      meter: 'blob-read',
      op: isFlag ? 'flag' : 'artifact',
      key: stored,
    });
    const body = blobs.get(stored);
    return body
      ? new Response(body.slice(), { status: 200 })
      : new Response(null, { status: 404 });
  }

  return { BLOB_TOKEN, calls, redisClients, Redis, put, del, fetchStub };
});

vi.mock('@upstash/redis', () => ({ Redis: fake.Redis }));
vi.mock('@vercel/blob', () => ({ put: fake.put, del: fake.del }));

// ---- the budget ----

// The device under test is shared: a primary owner plus one member who
// joined by share code, so every per-owner cost shows up per owner.
const OWNER_A = 'owner-a'; // primary owner: holds the presence slot
const OWNER_B = 'owner-b'; // member
const OWNERS = [OWNER_A, OWNER_B];

// Windows, copied from the code (a change to any of them changes the bill
// and must fail here first):
// lib/ops/device-service.js:23 NEXT_SAFETY_MS — /next trusts the queue flag this long.
const NEXT_SAFETY_MS = 60_000;
// lib/ops/device-service.js:24 TICK_SAFETY_MS — /tick trusts the tick flag this long.
const TICK_SAFETY_MS = 300_000;
// lib/device-presence.js:15 WRITE_EVERY_MS — presence write throttle.
const PRESENCE_EVERY_MS = 60_000;
// lib/devices.js:41 CACHE_TTL_MS — in-memory token cache; a miss costs one
// mirror GET (lib/devices.js:391). So a warm instance re-reads the mirror
// every 5 minutes, not once per cold start as lib/devices.js:9-10 says.
// docs/store-costs.md counts this GET: 288 a day.
const TOKEN_CACHE_TTL_MS = 300_000;
// firmware/docket-agent/docket-agent.ino:56-57 POLL_MS / TICK_MS.
const POLL_MS = 5_000;
const TICK_MS = 30_000;

// Per-request costs:
// lib/ops/device-service.js:83-84 — inside the window each owner costs one flag
// read and is skipped on seen === false: no Redis, no Postgres.
const IDLE_POLL_FLAG_READS_PER_OWNER = 1;
// lib/ops/device-service.js:121-122 — same shape for the tick flag.
const IDLE_TICK_FLAG_READS_PER_OWNER = 1;
// lib/job-store.js:256 — the empty-queue claim is one EVAL; a null id
// returns at :257 before rowFor (:259), and no flag write follows: the
// flag read just before the claim already says false
// (lib/change-signal.js setQueueSignal).
const EMPTY_QUEUE_CLAIM_REDIS_PER_OWNER = 1;
// lib/ops/device-service.js:124 claimDuePlugins → one EVAL
// (lib/stores/plugins-redis.js:67), then :127 syncTickSignal →
// earliestDueAt → one ZRANGE (lib/stores/plugins-redis.js:75); the
// unchanged flag write is deduped (lib/change-signal.js:81).
// docs/store-costs.md counts this check as 2 commands: 576 a day.
const IDLE_TICK_CLAIM_REDIS_PER_OWNER = 2;
// lib/device-presence.js:20-22 — one SET per window, primary owner only.
const PRESENCE_WRITES_PER_WINDOW = 1;
// A queued job: lib/job-store.js:256 one EVAL returns the id; then
// :259 rowFor → one SELECT and :267 setStatus → one UPDATE, both after
// the claim; :269 one artifact fetch for the ESC/POS bytes.
const CLAIMED_JOB_REDIS = ['eval'];
const CLAIMED_JOB_POSTGRES = ['select', 'update'];
const CLAIMED_JOB_ARTIFACT_READS = 1;

// Ten idle minutes of firmware cadence, extrapolated in the comment:
// 40 commands / 10 min = 5,760/day ≈ 173K per 30 days for this
// two-owner device.
const IDLE_SPAN_MS = 10 * 60_000;
const IDLE_SPAN_REDIS = {
  presence: (IDLE_SPAN_MS / PRESENCE_EVERY_MS) * PRESENCE_WRITES_PER_WINDOW, // 10
  tokenMirror: IDLE_SPAN_MS / TOKEN_CACHE_TTL_MS, // 2
  nextClaims:
    OWNERS.length *
    (IDLE_SPAN_MS / NEXT_SAFETY_MS) *
    EMPTY_QUEUE_CLAIM_REDIS_PER_OWNER, // 20
  tickClaims:
    OWNERS.length *
    (IDLE_SPAN_MS / TICK_SAFETY_MS) *
    IDLE_TICK_CLAIM_REDIS_PER_OWNER, // 8
};

// ---- harness ----

const T0 = Date.parse('2026-10-12T12:00:00Z'); // 08:00 New York
const WARM_GAP_MS = 10 * 60_000; // longer than every window above

const flagPath = (purpose: string, owner: string) => `${purpose}/${owner}.json`;
const sha256 = (s: string) =>
  crypto.createHash('sha256').update(s).digest('hex');

type DbLike = object;
const g = globalThis as { __docketDbPromise?: Promise<DbLike> };
let originalDbPromise: Promise<DbLike> | undefined;

// drizzle entry points that build or run a query.
const PG_ENTRY_POINTS = new Set([
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'insert',
  'update',
  'delete',
  'execute',
  'transaction',
  'with',
  '$with',
  '$count',
  'query',
  'refreshMaterializedView',
]);

function countingDb(db: DbLike): DbLike {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && PG_ENTRY_POINTS.has(prop)) {
        fake.calls.push({ meter: 'pg', op: prop, key: '' });
      }
      // Bind to the real instance so drizzle's internal this.select() etc.
      // are not counted twice.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

type Route = (req: Request) => Promise<Response>;
let nextGET: Route;
let tickPOST: Route;
let deviceToken = '';
let clock = T0;

function at(ms: number) {
  clock = ms;
  vi.setSystemTime(ms);
}

const authHeaders = () => ({ authorization: `Bearer ${deviceToken}` });
const poll = () =>
  nextGET(new Request('http://docket.test/next', { headers: authHeaders() }));
const tick = () =>
  tickPOST(
    new Request('http://docket.test/tick', {
      method: 'POST',
      headers: authHeaders(),
      body: '',
    }),
  );

// recordDeviceSeen fires its SET without awaiting; let it land before
// reading the log.
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};

type Cost = {
  status: number;
  res: Response;
  redis: string[]; // "op key"
  pg: string[]; // entry point names
  flagReads: string[];
  artifactReads: string[];
  blobWrites: string[];
  network: string[];
  log: typeof fake.calls;
};

async function measure(request: () => Promise<Response>): Promise<Cost> {
  await settle();
  const from = fake.calls.length;
  const res = await request();
  await settle();
  const log = fake.calls.slice(from);
  const pick = (meter: string, op?: string) =>
    log.filter((c) => c.meter === meter && (!op || c.op === op));
  return {
    status: res.status,
    res,
    redis: pick('redis').map((c) => `${c.op} ${c.key}`),
    pg: pick('pg').map((c) => c.op),
    flagReads: pick('blob-read', 'flag').map((c) => c.key),
    artifactReads: pick('blob-read', 'artifact').map((c) => c.key),
    blobWrites: pick('blob-write').map((c) => `${c.op} ${c.key}`),
    network: pick('network').map((c) => c.key),
    log,
  };
}

// Let every window lapse, then one poll and one tick reset them all: the
// token is cached, presence written, and both safety checks just ran.
async function warmUp() {
  at(clock + WARM_GAP_MS);
  expect((await poll()).status).toBe(204);
  expect((await tick()).status).toBe(200);
  await settle();
  return clock;
}

type Step = { offset: number; kind: 'poll' | 'tick'; cost: Cost };

// The firmware cadence from `from` to `to` (inclusive): the loop checks
// the tick before the poll (docket-agent.ino:406-414).
async function runDevice(from: number, to: number): Promise<Step[]> {
  const steps: Step[] = [];
  for (let t = from + POLL_MS; t <= to; t += POLL_MS) {
    at(t);
    if ((t - from) % TICK_MS === 0) {
      steps.push({ offset: t - from, kind: 'tick', cost: await measure(tick) });
    }
    steps.push({ offset: t - from, kind: 'poll', cost: await measure(poll) });
  }
  return steps;
}

const sorted = (xs: string[]) => [...xs].sort();

beforeAll(async () => {
  // Hosted mode is chosen at module load (config.js STORE_DRIVER, Redis
  // and Blob credentials), so stub the env first and import afterwards.
  vi.stubEnv('STORE_DRIVER', 'redis');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake-upstash.invalid');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-upstash-token');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', fake.BLOB_TOKEN);
  vi.stubEnv(
    'DATA_DIR',
    path.join(process.env.DATA_DIR || os.tmpdir(), 'meter-budget'),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  at(T0);
  vi.resetModules();

  const { getDb } = await import('@/lib/db.js');
  const realDb = await getDb();
  originalDbPromise = g.__docketDbPromise;
  g.__docketDbPromise = Promise.resolve(countingDb(realDb));
  vi.stubGlobal('fetch', fake.fetchStub);

  const devices = await import('@/lib/devices.js');
  const setup = await import('@/lib/plugin-setup.js');
  const registry = await import('@/lib/plugin-registry.js');
  nextGET = (await import('@/app/next/route.ts')).GET;
  tickPOST = (await import('@/app/tick/route.ts')).POST;

  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});

  // Pair a real device: it asks for a code, the owner claims the code, the
  // device collects its token.
  const { code } = await devices.beginPairing('meter-budget-hw');
  const claimed = await devices.claimDevice(OWNER_A, code, 'kitchen');
  const collected = await devices.pollPairing('meter-budget-hw', code);
  if (!claimed || !collected) throw new Error('pairing failed');
  deviceToken = collected.token;

  // Share it with a second account.
  const share = await devices.mintShareCode(OWNER_A, claimed.id);
  if (!share) throw new Error('share code failed');
  await devices.joinDevice(OWNER_B, share.code);

  // Each owner's Slips visit registers the plugins; leave the daily brief
  // as the only scheduled one (its next run is ~22h away, so no tick in
  // this file is due to run it).
  for (const owner of OWNERS) {
    await setup.ensureRegistered(owner);
    await registry.setEnabled(owner, 'espn-worldcup', false);
    await registry.setEnabled(owner, 'morning-brief', true);
  }
  quiet.mockRestore();
});

afterAll(() => {
  g.__docketDbPromise = originalDbPromise;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('device cadence meter budget (hosted mode)', () => {
  it('runs hosted against the fakes, for a device serving two owners', async () => {
    const config = await import('@/config.js');
    const signals = await import('@/lib/change-signal.js');
    const devices = await import('@/lib/devices.js');
    expect(config.STORE_DRIVER).toBe('redis');
    expect(config.DATABASE_URL).toBe('');
    expect(signals.signalsConfigured()).toBe(true);
    expect(fake.redisClients).toEqual(['https://fake-upstash.invalid']);
    expect(await devices.resolveDeviceToken(deviceToken)).toMatchObject({
      ownerId: OWNER_A,
      owners: OWNERS,
    });
  });

  it('idle GET /next inside the safety window: 0 Postgres, 0 Redis, 1 flag read per owner', async () => {
    const w = await warmUp();
    for (let t = w + POLL_MS; t < w + NEXT_SAFETY_MS; t += POLL_MS) {
      at(t);
      const cost = await measure(poll);
      expect(cost.status).toBe(204);
      expect(cost.pg).toEqual([]);
      expect(cost.redis).toEqual([]);
      expect(cost.flagReads).toEqual(
        OWNERS.flatMap((o) =>
          Array(IDLE_POLL_FLAG_READS_PER_OWNER).fill(flagPath('queue-flag', o)),
        ),
      );
      expect(cost.blobWrites).toEqual([]);
      expect(cost.network).toEqual([]);
    }
  });

  it('GET /next once the safety window passes runs the empty-queue claim, still 0 Postgres', async () => {
    const w = await warmUp();
    at(w + NEXT_SAFETY_MS);
    const cost = await measure(poll);
    expect(cost.status).toBe(204);
    expect(cost.pg).toEqual([]);
    const claims = cost.redis.filter((c) => c.includes(':jobs:'));
    expect(sorted(claims)).toEqual(
      OWNERS.flatMap((o) =>
        Array(EMPTY_QUEUE_CLAIM_REDIS_PER_OWNER).fill(
          `eval rp:${o}:jobs:queue`,
        ),
      ),
    );
    // The presence throttle has the same 60s length, so this poll also
    // carries the heartbeat; nothing else.
    expect(sorted(cost.redis)).toEqual(
      sorted([...claims, `set rp:${OWNER_A}:state:device`]),
    );
    // The safety check reads the flag too: queue flag writes follow a
    // fresh read, never what this instance last wrote. It says false, so
    // the empty claim writes nothing.
    expect(cost.flagReads).toEqual(
      OWNERS.map((o) => flagPath('queue-flag', o)),
    );
    expect(cost.blobWrites).toEqual([]);

    // The claim restarts the window: the next poll is idle again.
    at(w + NEXT_SAFETY_MS + POLL_MS);
    const after = await measure(poll);
    expect(after.redis).toEqual([]);
    expect(after.pg).toEqual([]);
  });

  it('presence: at most 1 Redis write per throttle window across many polls', async () => {
    const w = await warmUp();
    const windows = 10;
    const steps = await runDevice(w, w + windows * PRESENCE_EVERY_MS);
    const writes = steps.flatMap((s) =>
      s.cost.redis
        .filter((c) => c.endsWith(':state:device'))
        .map((c) => ({ offset: s.offset, c })),
    );
    expect(steps.filter((s) => s.kind === 'poll')).toHaveLength(
      (windows * PRESENCE_EVERY_MS) / POLL_MS,
    );
    expect(writes).toHaveLength(windows * PRESENCE_WRITES_PER_WINDOW);
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i].offset - writes[i - 1].offset).toBeGreaterThanOrEqual(
        PRESENCE_EVERY_MS,
      );
    }
    // One heartbeat per device, on the primary owner's slot.
    expect(new Set(writes.map((x) => x.c))).toEqual(
      new Set([`set rp:${OWNER_A}:state:device`]),
    );
  });

  it('idle POST /tick inside its safety window: 0 Postgres, 0 Redis, 1 flag read per owner', async () => {
    const w = await warmUp();
    const expectIdle = (cost: Cost) => {
      expect(cost.status).toBe(200);
      expect(cost.pg).toEqual([]);
      expect(cost.redis).toEqual([]);
      expect(cost.flagReads).toEqual(
        OWNERS.flatMap((o) =>
          Array(IDLE_TICK_FLAG_READS_PER_OWNER).fill(flagPath('tick-flag', o)),
        ),
      );
      expect(cost.blobWrites).toEqual([]);
    };

    at(w + TICK_MS);
    const early = await measure(tick);
    expectIdle(early);
    expect(await early.res.json()).toEqual({ results: [], idle: true });

    // Late in the window, after a poll has taken the presence write.
    at(w + TICK_SAFETY_MS - POLL_MS);
    await measure(poll);
    at(w + TICK_SAFETY_MS - 1_000);
    expectIdle(await measure(tick));
  });

  it('POST /tick once its safety window passes runs the due claim, still 0 Postgres', async () => {
    const w = await warmUp();
    at(w + TICK_SAFETY_MS);
    await measure(poll); // takes this moment's presence write and token refresh
    const cost = await measure(tick);
    expect(cost.status).toBe(200);
    expect(cost.pg).toEqual([]);
    expect(sorted(cost.redis)).toEqual(
      sorted(
        OWNERS.flatMap((o) => [
          `eval rp:${o}:plugins:due`,
          `zrange rp:${o}:plugins:due`,
        ]),
      ),
    );
    expect(cost.redis).toHaveLength(
      OWNERS.length * IDLE_TICK_CLAIM_REDIS_PER_OWNER,
    );
    expect(cost.flagReads).toEqual([]);
    expect(cost.blobWrites).toEqual([]); // same quantized nextDueAt: deduped
  });

  it('ten idle minutes of firmware cadence cost a fixed Redis budget and 0 Postgres', async () => {
    const w = await warmUp();
    const steps = await runDevice(w, w + IDLE_SPAN_MS);
    const all = steps.flatMap((s) => s.cost.redis);
    const mirrorKey = `rp:_devices:token:${sha256(deviceToken)}`;

    expect({
      presence: all.filter((c) => c === `set rp:${OWNER_A}:state:device`)
        .length,
      tokenMirror: all.filter((c) => c === `get ${mirrorKey}`).length,
      nextClaims: all.filter((c) => c.includes(':jobs:')).length,
      tickClaims: all.filter((c) => c.includes(':plugins:due')).length,
    }).toEqual(IDLE_SPAN_REDIS);
    expect(all).toHaveLength(
      Object.values(IDLE_SPAN_REDIS).reduce((a, b) => a + b, 0),
    );

    expect(steps.flatMap((s) => s.cost.pg)).toEqual([]);
    expect(steps.flatMap((s) => s.cost.blobWrites)).toEqual([]);
    expect(steps.flatMap((s) => s.cost.network)).toEqual([]);
    expect(
      steps.every((s) => s.cost.status === (s.kind === 'poll' ? 204 : 200)),
    ).toBe(true);

    const polls = steps.filter((s) => s.kind === 'poll').length;
    const ticks = steps.filter((s) => s.kind === 'tick').length;
    const tickChecks = IDLE_SPAN_MS / TICK_SAFETY_MS;
    const reads = steps.flatMap((s) => s.cost.flagReads);
    // Every poll reads each owner's queue flag, safety checks included.
    expect(reads.filter((r) => r.startsWith('queue-flag/'))).toHaveLength(
      OWNERS.length * polls,
    );
    expect(reads.filter((r) => r.startsWith('tick-flag/'))).toHaveLength(
      OWNERS.length * (ticks - tickChecks),
    );
  });

  // A member who has switched off every scheduled plugin has an empty
  // due-index, so their tick flag says nextDueAt: null ("nothing scheduled
  // at all"). lib/plugin-registry.js:75 must trust that as idle too; otherwise
  // that member pays the real claim (EVAL + ZRANGE) on every 30s tick,
  // ~5,760 commands a day. It changes the member's plugins and restores
  // them in finally. It runs before the queued-job test, whose un-acked
  // job is redelivered once its 120s lease lapses.
  it('idle POST /tick for a member with nothing scheduled: 0 Redis, 0 Postgres', async () => {
    const registry = await import('@/lib/plugin-registry.js');
    const signals = await import('@/lib/change-signal.js');
    await registry.setEnabled(OWNER_B, 'morning-brief', false);
    try {
      const w = await warmUp();
      expect(await registry.earliestDueAt(OWNER_B)).toBeNull();
      expect(await signals.readTickSignal(OWNER_B)).toEqual({
        nextDueAt: null,
      });
      for (const offset of [TICK_MS, TICK_SAFETY_MS - 1_000]) {
        at(w + offset);
        const cost = await measure(tick);
        expect(cost.status).toBe(200);
        expect(await cost.res.json()).toEqual({ results: [], idle: true });
        expect(cost.pg).toEqual([]);
        expect(cost.redis.filter((c) => !c.endsWith(':state:device'))).toEqual(
          [],
        );
        expect(cost.flagReads).toEqual(
          OWNERS.map((o) => flagPath('tick-flag', o)),
        );
        expect(cost.blobWrites).toEqual([]);
      }
    } finally {
      await registry.setEnabled(OWNER_B, 'morning-brief', true);
    }
  });

  it('a queued job: one EVAL claims it, Postgres only after the claim', async () => {
    const { createRawJob } = await import('@/lib/job-store.js');
    const w = await warmUp();

    // Dashboard side (not metered here): queue a raw job for the primary.
    at(w + 1_000);
    const bytes = Buffer.from([0x1b, 0x40, 0x0a]);
    const { id } = await createRawJob(OWNER_A, {
      name: 'meter probe',
      source: 'test',
      bytes,
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    });

    at(w + POLL_MS);
    const cost = await measure(poll);
    expect(cost.status).toBe(200);
    expect(cost.res.headers.get('X-Job-Id')).toBe(`${OWNER_A}~${id}`);
    expect(cost.res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(cost.redis.map((c) => c.split(' ')[0])).toEqual(CLAIMED_JOB_REDIS);
    expect(cost.redis[0]).toBe(`eval rp:${OWNER_A}:jobs:queue`);
    expect(cost.pg).toEqual(CLAIMED_JOB_POSTGRES);
    // The primary's flag said "work"; the job is served before the member
    // is visited.
    expect(cost.flagReads).toEqual([flagPath('queue-flag', OWNER_A)]);
    expect(cost.artifactReads).toHaveLength(CLAIMED_JOB_ARTIFACT_READS);
    expect(cost.blobWrites).toEqual([]);
    const claimAt = cost.log.findIndex((c) => c.meter === 'redis');
    const firstPg = cost.log.findIndex((c) => c.meter === 'pg');
    expect(firstPg).toBeGreaterThan(claimAt);

    // The flag stays "work" until a claim finds the queue empty: one more
    // EVAL, one flag write, still no Postgres.
    at(w + 2 * POLL_MS);
    const verify = await measure(poll);
    expect(verify.status).toBe(204);
    expect(verify.redis).toEqual([`eval rp:${OWNER_A}:jobs:queue`]);
    expect(verify.pg).toEqual([]);
    expect(verify.flagReads).toEqual(
      OWNERS.map((o) => flagPath('queue-flag', o)),
    );
    expect(verify.blobWrites).toEqual([
      `put ${flagPath('queue-flag', OWNER_A)}`,
    ]);

    // Then idle again.
    at(w + 3 * POLL_MS);
    const idle = await measure(poll);
    expect(idle.redis).toEqual([]);
    expect(idle.pg).toEqual([]);
  });
});
