// tests/device-wire.test.ts — the HTTP contract the ESP32 firmware
// (firmware/docket-agent/docket-agent.ino) depends on. Changing any of
// this breaks printers already in the field, which cannot be reflashed
// remotely. What the firmware relies on:
//
//   GET /next    Authorization: Bearer <token>; 204 = queue empty;
//                200 = job: X-Job-Id header (echoed raw into /ack and
//                /nack query strings), body length from Content-Length
//                via http.getSize() (no length = stalled stream = nack
//                forever); 401 counts toward the token wipe.
//   POST /ack    ?job=<X-Job-Id>, empty body; only 200 ends the
//                firmware's pending-ack retry loop, which blocks new jobs.
//   POST /nack   ?job=<X-Job-Id>, empty body; the job must come back.
//   POST /tick   empty body; firmware reads only the status (200 ok,
//                401 counts toward the wipe); agent/heartbeat.js reads
//                body.results[].{id,status,error}.
//   POST /pair   JSON {hardwareId[, code]}, no auth; firmware reads the
//                body only on 200 and pulls "code" / "token" out with a
//                substring search for `"field":"` (no JSON parser); 204
//                while the code is unclaimed.
//   401 wipe     10 consecutive 401s from /next or /tick make the firmware
//                erase its paired token and re-pair, so only a revoked or
//                unknown token may answer 401, never a store failure.

import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { POST as ackRoute } from '@/app/ack/route.ts';
import { POST as nackRoute } from '@/app/nack/route.ts';
import { GET as nextRoute } from '@/app/next/route.ts';
import { POST as pairRoute } from '@/app/pair/route.ts';
import { POST as tickRoute } from '@/app/tick/route.ts';
import { DATA_DIR, DEVICE_TOKEN, OWNER_ID } from '@/config.js';
import { job } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { claimDevice, revokeDevice } from '@/lib/devices.js';
import { createJob, createRawJob, getJob } from '@/lib/job-store.js';
import { upsertPlugin } from '@/lib/plugin-registry.js';

// The json stores (plugins.json, device presence) are files in DATA_DIR,
// which every test file shares; give this file its own subfolder. Runs
// before the imports above load config.js.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/device-wire`;
});

const BASE = 'http://docket.test';
const g = globalThis as { __docketDbPromise?: unknown };

// ---- helpers ----

// Port of jsonField() in docket-agent.ino: find `"field":"` and read up to
// the next quote. Responses must stay parseable by exactly this.
function firmwareJsonField(body: string, field: string): string {
  const needle = `"${field}":"`;
  const i = body.indexOf(needle);
  if (i < 0) return '';
  const start = i + needle.length;
  const j = body.indexOf('"', start);
  if (j < 0) return '';
  return body.slice(start, j);
}

function deviceRequest(method: 'GET' | 'POST', path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  // The firmware POSTs an empty body to /ack, /nack and /tick.
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: method === 'POST' ? '' : undefined,
  });
}

const next = (token?: string) =>
  nextRoute(deviceRequest('GET', '/next', token));
// Job ids go into the query string raw, as the firmware concatenates them.
const ack = (id: string, token?: string) =>
  ackRoute(deviceRequest('POST', `/ack?job=${id}`, token));
const nack = (id: string, token?: string) =>
  nackRoute(deviceRequest('POST', `/nack?job=${id}`, token));
const tick = (token?: string) =>
  tickRoute(deviceRequest('POST', '/tick', token));

// /pair throttles 30 requests a minute per client IP; give each call its
// own address so the suite never trips it.
let ipCounter = 0;
function pairRequest(body: unknown) {
  ipCounter += 1;
  return new Request(`${BASE}/pair`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: JSON.stringify(body),
  });
}

const uniqueOwner = () => `owner-${crypto.randomUUID()}`;
const uniqueHardwareId = () =>
  `esp32-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

// The full pairing flow as the firmware and dashboard run it: device asks
// for a code, owner claims it, device polls the token. The token is not in
// lib/devices.js's memory cache afterwards (claimDevice and pollPairing
// never populate it under the json driver).
async function pairDevice(ownerId: string) {
  const hardwareId = uniqueHardwareId();
  const begin = await pairRoute(pairRequest({ hardwareId }));
  const code = firmwareJsonField(await begin.text(), 'code');
  const claimed = await claimDevice(ownerId, code, 'test printer');
  if (!claimed) throw new Error('claimDevice refused a fresh code');
  const poll = await pairRoute(pairRequest({ hardwareId, code }));
  const token = firmwareJsonField(await poll.text(), 'token');
  if (!token) throw new Error('pairing returned no token');
  return { token, deviceId: claimed.id as string, hardwareId };
}

// Binary-hostile payload: NULs, ESC/GS commands, 0xFF, CR/LF.
function escposBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x00, 0xff, 0x0d, 0x0a, 0x1d, 0x56, 0x01]),
    crypto.randomBytes(2048),
  ]);
}

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function queueRawJob(ownerId: string) {
  const bytes = escposBytes();
  const created = await createRawJob(ownerId, {
    name: 'wire test',
    source: 'test',
    bytes,
    png: PNG_STUB,
    width: 576,
    height: 8,
  });
  return { id: created.id as string, bytes };
}

async function bodyBytes(res: Response) {
  return Buffer.from(await res.arrayBuffer());
}

// Swap the Postgres singleton for a broken stand-in; returns a counter of
// how often the handler reached for it and a restore function.
function breakPostgres(mode: 'connect' | 'query') {
  const saved = g.__docketDbPromise;
  const touched = { count: 0 };
  if (mode === 'connect') {
    // A thenable that rejects only when awaited: no unhandled rejection.
    g.__docketDbPromise = {
      // biome-ignore lint/suspicious/noThenProperty: stand-in for a rejected connection promise
      then(_resolve: unknown, reject: (err: Error) => void) {
        touched.count += 1;
        reject(new Error('postgres unavailable (connect)'));
      },
    };
  } else {
    const db = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return undefined; // resolves as a plain object
          return () => {
            touched.count += 1;
            throw new Error('postgres unavailable (query)');
          };
        },
      },
    );
    g.__docketDbPromise = Promise.resolve(db);
  }
  return {
    touched,
    restore: () => {
      g.__docketDbPromise = saved;
    },
  };
}

// ---- harness guards ----

const fetchSpy = vi.fn(async () => {
  throw new Error('network access is disabled in tests');
});

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  await getDb(); // migrate the in-memory PGlite once
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  // Nothing on the device wire may leave the process in tests.
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('runs against the dev token mapping from vitest.config.ts', () => {
  expect(DEVICE_TOKEN).toBe('test-device-token');
  expect(OWNER_ID).toBe('test-owner');
  expect(DATA_DIR).toMatch(/device-wire$/);
});

// ---- the wire contract, once per token kind ----

type Device = { token: string; owner: string };

const tokenKinds: Array<[string, () => Promise<Device>]> = [
  [
    'dev DEVICE_TOKEN',
    async () => {
      // The dev token always maps to OWNER_ID: reset its jobs instead of
      // using a fresh owner.
      const db = await getDb();
      await db.delete(job).where(eq(job.ownerId, OWNER_ID));
      return { token: DEVICE_TOKEN, owner: OWNER_ID };
    },
  ],
  [
    'paired per-device token',
    async () => {
      const owner = uniqueOwner();
      const { token } = await pairDevice(owner);
      return { token, owner };
    },
  ],
];

describe.each(tokenKinds)('device wire with a %s', (_kind, setup) => {
  let dev: Device;

  beforeEach(async () => {
    dev = await setup();
  });

  describe('GET /next', () => {
    it('answers 204 with no body when the queue is empty', async () => {
      const res = await next(dev.token);
      expect(res.status).toBe(204);
      expect((await bodyBytes(res)).length).toBe(0);
    });

    it('answers 200 with the job bytes, an explicit Content-Length and an owner-qualified X-Job-Id', async () => {
      const queued = await queueRawJob(dev.owner);

      const res = await next(dev.token);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      // http.getSize() reads this; a chunked response has none.
      expect(res.headers.get('content-length')).toBe(
        String(queued.bytes.length),
      );
      const jobId = res.headers.get('x-job-id');
      expect(jobId).toBe(`${dev.owner}~${queued.id}`);
      expect(jobId).toMatch(/^[^~]+~job-\d+$/);
      // The firmware appends it to "/ack?job=" without encoding.
      expect(encodeURIComponent(jobId as string)).toBe(jobId);

      const body = await bodyBytes(res);
      expect(body.length).toBe(queued.bytes.length);
      expect(body.equals(queued.bytes)).toBe(true);
    });

    it('serves a rendered job (createJob) with the stored bytes and matching Content-Length', async () => {
      const created = await createJob(dev.owner, {
        template:
          '<div style="display:flex;flex-direction:column;width:576px;background:#fff;color:#000;padding:24px;font-family:Sans;font-size:32px">{{ msg }}</div>',
        data: { msg: 'WIRE TEST' },
        name: 'rendered wire test',
        source: 'test',
      });
      const db = await getDb();
      const [row] = await db
        .select({ bytes: job.bytes })
        .from(job)
        .where(and(eq(job.ownerId, dev.owner), eq(job.id, created.id)));
      const stored = Buffer.from(row.bytes as string, 'base64');
      expect(stored.length).toBeGreaterThan(0);

      const res = await next(dev.token);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-job-id')).toBe(`${dev.owner}~${created.id}`);
      expect(res.headers.get('content-length')).toBe(String(stored.length));
      expect((await bodyBytes(res)).equals(stored)).toBe(true);
    });

    it('does not hand out a claimed job again before it is acked or nacked', async () => {
      await queueRawJob(dev.owner);
      expect((await next(dev.token)).status).toBe(200);
      expect((await next(dev.token)).status).toBe(204);
    });
  });

  describe('POST /ack', () => {
    it('marks the job done when given the X-Job-Id value', async () => {
      const queued = await queueRawJob(dev.owner);
      const jobId = (await next(dev.token)).headers.get('x-job-id') as string;

      const res = await ack(jobId, dev.token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ acked: jobId, found: true });
      expect((await getJob(dev.owner, queued.id))?.status).toBe('done');
      expect((await next(dev.token)).status).toBe(204);
    });

    it("still accepts a bare 'job-<n>' id (pre-sharing firmware)", async () => {
      const queued = await queueRawJob(dev.owner);
      expect((await next(dev.token)).status).toBe(200);

      const res = await ack(queued.id, dev.token);
      expect(res.status).toBe(200);
      expect((await res.json()).found).toBe(true);
      expect((await getJob(dev.owner, queued.id))?.status).toBe('done');
    });

    it('answers 200 to a repeated ack, so the firmware pending-ack retry ends', async () => {
      await queueRawJob(dev.owner);
      const jobId = (await next(dev.token)).headers.get('x-job-id') as string;
      expect((await ack(jobId, dev.token)).status).toBe(200);

      const again = await ack(jobId, dev.token);
      expect(again.status).toBe(200);
    });

    it('answers 4xx without the job parameter', async () => {
      const res = await ackRoute(deviceRequest('POST', '/ack', dev.token));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(401);
    });
  });

  describe('POST /nack', () => {
    it('requeues the job: the next GET /next returns the same job and bytes', async () => {
      const queued = await queueRawJob(dev.owner);
      const first = await next(dev.token);
      const jobId = first.headers.get('x-job-id') as string;

      const res = await nack(jobId, dev.token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ requeued: jobId, found: true });
      expect((await getJob(dev.owner, queued.id))?.status).toBe('queued');

      const again = await next(dev.token);
      expect(again.status).toBe(200);
      expect(again.headers.get('x-job-id')).toBe(jobId);
      expect(again.headers.get('content-length')).toBe(
        String(queued.bytes.length),
      );
      expect((await bodyBytes(again)).equals(queued.bytes)).toBe(true);
    });

    it('answers 4xx without the job parameter', async () => {
      const res = await nackRoute(deviceRequest('POST', '/nack', dev.token));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(401);
    });
  });

  describe('POST /tick', () => {
    it('answers 200 with a results array when nothing is due', async () => {
      const res = await tick(dev.token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [], idle: true });
    });
  });
});

// ---- authentication ----

describe('device authentication', () => {
  // Near misses of the dev token: the comparison must check every byte,
  // not just the length or a prefix.
  const lastChar = DEVICE_TOKEN.slice(-1);
  const sameLengthWrong = `${DEVICE_TOKEN.slice(0, -1)}${lastChar === 'x' ? 'y' : 'x'}`;

  const badAuth: Array<[string, Record<string, string>]> = [
    ['no Authorization header', {}],
    ['an unknown Bearer token', { authorization: 'Bearer not-a-real-token' }],
    ['an empty Bearer token', { authorization: 'Bearer ' }],
    [
      'the dev token without the Bearer scheme',
      { authorization: DEVICE_TOKEN },
    ],
    [
      'a wrong token as long as the dev token',
      { authorization: `Bearer ${sameLengthWrong}` },
    ],
    [
      'a prefix of the dev token',
      { authorization: `Bearer ${DEVICE_TOKEN.slice(0, -1)}` },
    ],
    [
      'the dev token with a suffix',
      { authorization: `Bearer ${DEVICE_TOKEN}x` },
    ],
    [
      'the dev token in upper case',
      { authorization: `Bearer ${DEVICE_TOKEN.toUpperCase()}` },
    ],
  ];

  const endpoints: Array<
    [string, (headers: Record<string, string>) => Promise<Response>]
  > = [
    [
      'GET /next',
      (headers) => nextRoute(new Request(`${BASE}/next`, { headers })),
    ],
    [
      'POST /ack',
      (headers) =>
        ackRoute(
          new Request(`${BASE}/ack?job=job-1`, {
            method: 'POST',
            headers,
            body: '',
          }),
        ),
    ],
    [
      'POST /nack',
      (headers) =>
        nackRoute(
          new Request(`${BASE}/nack?job=job-1`, {
            method: 'POST',
            headers,
            body: '',
          }),
        ),
    ],
    [
      'POST /tick',
      (headers) =>
        tickRoute(
          new Request(`${BASE}/tick`, { method: 'POST', headers, body: '' }),
        ),
    ],
  ];

  for (const [endpoint, call] of endpoints) {
    it.each(badAuth)(`${endpoint} answers 401 with %s`, async (_, headers) => {
      const res = await call(headers);
      expect(res.status).toBe(401);
    });
  }

  it('answers 401 on /next and /tick once the owner revokes the device (the re-pair signal)', async () => {
    const owner = uniqueOwner();
    const { token, deviceId } = await pairDevice(owner);
    expect((await next(token)).status).toBe(204);

    expect(await revokeDevice(owner, deviceId)).toBe(true);
    expect((await next(token)).status).toBe(401);
    expect((await tick(token)).status).toBe(401);
  });

  it("a paired token serves its own owner's queue, not the dev owner's", async () => {
    const owner = uniqueOwner();
    const { token } = await pairDevice(owner);
    await queueRawJob(OWNER_ID); // must not leak to a paired device
    const queued = await queueRawJob(owner);

    const res = await next(token);
    expect(res.headers.get('x-job-id')).toBe(`${owner}~${queued.id}`);
  });
});

// ---- tick results shape ----

describe('POST /tick results', () => {
  it('reports each due plugin as {id, status} in body.results', async () => {
    const owner = uniqueOwner();
    const { token } = await pairDevice(owner);
    // A due record whose module is not installed: the tick drops it
    // without running any plugin code (no network).
    await upsertPlugin({
      id: 'ghost-plugin',
      ownerId: owner,
      enabled: true,
      schedule: { every: 60 },
      nextDueAt: Date.now() - 1000,
      lastRunAt: null,
      config: {},
      state: {},
      lastError: null,
      lastErrorAt: null,
    });

    const res = await tick(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ id: 'ghost-plugin', status: 'dropped' }],
    });
  });
});

// ---- pairing ----

describe('POST /pair', () => {
  it('needs no credentials and returns a code the firmware can parse', async () => {
    const res = await pairRoute(
      pairRequest({ hardwareId: uniqueHardwareId() }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const code = firmwareJsonField(text, 'code');
    // Printed on paper and typed by a human: no 0/O/1/I.
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const body = JSON.parse(text);
    expect(body.code).toBe(code);
    expect(body.ttlSeconds).toBeGreaterThanOrEqual(14 * 60); // firmware re-mints at 14 min
    expect(typeof body.pollSeconds).toBe('number');
  });

  it('answers 204 while unclaimed, the token once after the claim, then 204', async () => {
    const owner = uniqueOwner();
    const hardwareId = uniqueHardwareId();
    const begin = await pairRoute(pairRequest({ hardwareId }));
    const code = firmwareJsonField(await begin.text(), 'code');

    const pending = await pairRoute(pairRequest({ hardwareId, code }));
    expect(pending.status).toBe(204);

    expect(await claimDevice(owner, code, 'test printer')).not.toBeNull();

    const claimed = await pairRoute(pairRequest({ hardwareId, code }));
    expect(claimed.status).toBe(200);
    const token = firmwareJsonField(await claimed.text(), 'token');
    // base64url: survives the quote-delimited parser and an HTTP header.
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const collected = await pairRoute(pairRequest({ hardwareId, code }));
    expect(collected.status).toBe(204);

    // The collected token is a working device token for that owner.
    const queued = await queueRawJob(owner);
    const res = await next(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-job-id')).toBe(`${owner}~${queued.id}`);
  });

  it('answers 400 without a hardwareId', async () => {
    const res = await pairRoute(pairRequest({}));
    expect(res.status).toBe(400);
  });
});

// ---- store failures must not look like a revoked token ----

describe('a Postgres failure never answers 401', () => {
  const cases: Array<
    ['connect' | 'query', string, (token: string) => Promise<Response>]
  > = [
    ['connect', 'GET /next', next],
    ['query', 'GET /next', next],
    ['connect', 'POST /tick', tick],
    ['query', 'POST /tick', tick],
  ];

  it.each(
    cases,
  )('when the %s fails during %s with an uncached paired token', async (mode, _endpoint, call) => {
    const owner = uniqueOwner();
    // Fresh pairing, never used on a route: resolveDeviceToken has no
    // cache entry and must ask Postgres.
    const { token } = await pairDevice(owner);

    const broken = breakPostgres(mode);
    let outcome: number | 'threw';
    try {
      outcome = await call(token).then(
        (res) => res.status,
        () => 'threw' as const,
      );
    } finally {
      broken.restore();
    }

    // The handler really reached the broken store (not a cache hit).
    expect(broken.touched.count).toBeGreaterThan(0);
    // A thrown handler becomes a 500 in Next.js; either is fine.
    expect(outcome).not.toBe(401);
    if (outcome !== 'threw') expect(outcome).toBeGreaterThanOrEqual(500);

    // The failure did not poison the token: once Postgres is back the
    // same token works.
    const after = await call(token);
    expect(after.status).toBe(call === next ? 204 : 200);
  });
});
