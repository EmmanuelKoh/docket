// tests/helpers/fake-hosted.ts — in-process stand-ins for the metered
// hosted services, so a test can run STORE_DRIVER=redis with no network:
//   Redis  @upstash/redis replaced by an in-memory client that logs every
//          command (including both claim Lua scripts, run in JS)
//   Blob   @vercel/blob put/del write an in-memory map; fetchStub serves
//          that map (flag and artifact reads) and throws for any other URL
// The same fakes as tests/meter-budget.test.ts:24-297, which keeps its
// own inline copy (it is a frozen file), plus the hash commands (HINCRBY,
// HGETALL, HDEL) that count failed print attempts, SET's NX and EX options
// (lib/kv.js claims and expiries), LLEN and ZCARD (the queue's size), and
// LRANGE (its order, for the Queue page while a job waits at the back).
// The meter test's paths never send those, and its copy rejects any
// command it lacks.
//   Postgres  countPostgres() logs each drizzle query entry point as one
//          'pg' call (the meter test's countingDb).
//
// Usage (tests/queue/redis.test.ts does this; paths relative to the test):
//   await vi.hoisted(async () => {      // before config.js loads
//     const { HOSTED_ENV } = await import('../helpers/fake-hosted');
//     Object.assign(process.env, HOSTED_ENV);
//   });
//   vi.mock('@upstash/redis', () => import('../helpers/fake-hosted'));
//   vi.mock('@vercel/blob', () => import('../helpers/fake-hosted'));
//   beforeAll: vi.stubGlobal('fetch', fetchStub);
//
// State lives on globalThis, so a vi.resetModules() that re-imports this
// file still sees the same store and call log. Test files run in separate
// workers, so nothing leaks between files.

// Mixed case on purpose: the store id comes from the token as written,
// while URL parsing lowercases hosts. Code that compares hosts must too.
export const BLOB_STORE_ID = 'FakeHostedStore';
export const BLOB_HOST = `${BLOB_STORE_ID.toLowerCase()}.public.blob.vercel-storage.com`;
// lib/change-signal.js derives flag URLs from this token shape:
// vercel_blob_rw_{storeId}_{secret}.
export const BLOB_TOKEN = `vercel_blob_rw_${BLOB_STORE_ID}_notarealsecret`;

// Everything config.js and lib/redis.js need to choose the hosted drivers.
export const HOSTED_ENV = {
  STORE_DRIVER: 'redis',
  UPSTASH_REDIS_REST_URL: 'https://fake-upstash.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'fake-upstash-token',
  BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
};

// One ordered log for every metered call, so a test can check both how
// many and in what order.
export type Call = {
  meter: 'redis' | 'pg' | 'blob-write' | 'blob-read' | 'network';
  op: string;
  key: string;
};

type State = {
  calls: Call[];
  kv: Map<string, string>;
  expiries: Map<string, number>; // kv key -> expiry, epoch ms (SET EX)
  hashes: Map<string, Map<string, string>>;
  lists: Map<string, string[]>;
  zsets: Map<string, Map<string, number>>;
  sets: Map<string, Set<string>>;
  blobs: Map<string, Uint8Array>;
  redisClients: string[];
  suffix: number;
};

const g = globalThis as { __docketFakeHosted?: State };
g.__docketFakeHosted ??= {
  calls: [],
  kv: new Map(),
  expiries: new Map(),
  hashes: new Map(),
  lists: new Map(),
  zsets: new Map(),
  sets: new Map(),
  blobs: new Map(),
  redisClients: [],
  suffix: 0,
};
const state: State = g.__docketFakeHosted;

export const {
  calls,
  kv,
  expiries,
  hashes,
  lists,
  zsets,
  sets,
  blobs,
  redisClients,
} = state;

// ---- Redis ----

export const listOf = (key: string) => {
  let l = lists.get(key);
  if (!l) {
    l = [];
    lists.set(key, l);
  }
  return l;
};
export const zsetOf = (key: string) => {
  let z = zsets.get(key);
  if (!z) {
    z = new Map();
    zsets.set(key, z);
  }
  return z;
};
export const hashOf = (key: string) => {
  let h = hashes.get(key);
  if (!h) {
    h = new Map();
    hashes.set(key, h);
  }
  return h;
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
const JOB_CLAIM_MARK = "redis.call('LPOP', KEYS[1])"; // lib/queue/redis.js CLAIM_LUA
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

// A key past its expiry is gone, as Redis would have evicted it (Date.now,
// so fake timers move it).
const expire = (key: string) => {
  const at = expiries.get(key);
  if (at !== undefined && at <= Date.now()) {
    kv.delete(key);
    expiries.delete(key);
  }
};

const commands = {
  async get(key: string) {
    expire(key);
    return decode(kv.get(key));
  },
  // NX: write only when absent (null otherwise); EX: expire after seconds.
  // A SET without EX clears an earlier expiry, as in Redis.
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    expire(key);
    if (opts?.nx && kv.has(key)) return null;
    kv.set(key, JSON.stringify(value));
    if (opts?.ex) expiries.set(key, Date.now() + opts.ex * 1000);
    else expiries.delete(key);
    return 'OK';
  },
  async del(...keys: string[]) {
    let removed = 0;
    for (const k of keys) {
      expire(k);
      if (kv.delete(k)) removed++;
      expiries.delete(k);
    }
    return removed;
  },
  async mget(...keys: string[]) {
    keys.forEach(expire);
    return keys.map((k) => decode(kv.get(k)));
  },
  async incr(key: string) {
    const n = Number(kv.get(key) ?? 0) + 1;
    kv.set(key, String(n));
    return n;
  },
  async hincrby(key: string, field: string, by: number) {
    const h = hashOf(key);
    const n = Number(h.get(field) ?? 0) + Number(by);
    h.set(field, String(n));
    return n;
  },
  // @upstash/redis decodes each value, so counts come back as numbers;
  // an empty or missing hash is null.
  async hgetall(key: string) {
    const h = hashOf(key);
    if (!h.size) return null;
    return Object.fromEntries([...h].map(([f, v]) => [f, decode(v)]));
  },
  async hdel(key: string, ...fields: string[]) {
    const h = hashOf(key);
    return fields.filter((f) => h.delete(f)).length;
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
  async llen(key: string) {
    return listOf(key).length;
  },
  async lrange(key: string, start: number, stop: number) {
    const l = listOf(key);
    return l.slice(start, (stop < 0 ? l.length + stop : stop) + 1);
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
  async zcard(key: string) {
    return zsetOf(key).size;
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
export function Redis(opts: { url: string; token: string }) {
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

export async function put(
  pathname: string,
  body: string | Uint8Array,
  opts: { addRandomSuffix?: boolean } = {},
) {
  const stored = opts.addRandomSuffix
    ? pathname.replace(/(\.[^./]*)?$/, `-r${++state.suffix}$1`)
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

export async function del(urls: string | string[]) {
  for (const u of [urls].flat()) {
    const stored = new URL(u).pathname.slice(1);
    calls.push({ meter: 'blob-write', op: 'del', key: stored });
    blobs.delete(stored);
  }
}

// Stand-in for global fetch: serves the blob map, refuses the network.
export async function fetchStub(input: string | URL | Request) {
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

// ---- Postgres ----

// drizzle entry points that build or run a query (tests/meter-budget.test.ts).
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

// From now on every query through lib/db.js getDb() logs one 'pg' call.
// lib/db.js keeps the client promise on globalThis, so wrapping it there
// reaches every module that imported getDb.
export async function countPostgres() {
  const { getDb } = await import('@/lib/db.js');
  const db = (await getDb()) as object;
  const counted = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && PG_ENTRY_POINTS.has(prop)) {
        calls.push({ meter: 'pg', op: prop, key: '' });
      }
      // Bound to the real instance so drizzle's own this.select() and the
      // like are not counted twice.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  (globalThis as { __docketDbPromise?: Promise<unknown> }).__docketDbPromise =
    Promise.resolve(counted);
}
