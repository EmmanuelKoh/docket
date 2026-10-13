// tests/device-service.test.ts — lib/ops/device-service.js cases the
// frozen wire and meter tests do not reach: a tick flag of 0 still claims
// inside the safety window; an ack or nack for an owner the device no
// longer serves answers {gone: true} and touches nothing; the queue flag
// follows a fresh read, not this instance's last write (audit M1.L1),
// and falls back to that memory only while the flag cannot be read; a
// job nacked 3 times waits behind later jobs, and the Queue view lists it
// there (reading the queue's order only then); an owner re-pairing keeps
// the members in the token mirror; a non-device caller; and the device
// error mapping (never 401).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deviceErrorResponse } from '@/app/_lib/device-auth';
import { queueData } from '@/app/_lib/queue-data';
import { POST as ackRoute } from '@/app/ack/route.ts';
import { POST as nackRoute } from '@/app/nack/route.ts';
import { DEVICE_TOKEN } from '@/config.js';
import {
  beginPairing,
  claimDevice,
  joinDevice,
  mintShareCode,
  pollPairing,
  resolveDeviceToken,
} from '@/lib/devices.js';
import { createRawJob, listJobs } from '@/lib/job-store.js';
import { deviceCaller, userCaller } from '@/lib/ops/caller.js';
import { OpError } from '@/lib/ops/define.js';
import { ack, nack, runDue, serveNext } from '@/lib/ops/device-service.js';
import {
  BLOB_HOST,
  blobs,
  calls,
  put as fakePut,
  fetchStub,
  listOf,
} from './helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('./helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/device-service`,
  });
});

vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('./helpers/fake-hosted'));

const T0 = Date.parse('2026-10-12T12:00:00Z');

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const newOwner = () => `owner-${randomUUID()}`;
const rawJob = {
  name: 'device service test',
  source: 'test',
  bytes: Buffer.from([0x1b, 0x40, 0x0a]),
  png: Buffer.from('png'),
  width: 576,
  height: 1,
};
const device = (owner: string) =>
  deviceCaller({ ownerId: owner, deviceId: `dev-${owner}`, owners: [owner] });

// Overwrite the owner's tick flag the way lib/change-signal.js stores it.
const setTickFlag = (owner: string, nextDueAt: number | null) =>
  fakePut(`tick-flag/${owner}.json`, JSON.stringify({ nextDueAt }));

// Metered calls made by fn, as "meter op key".
async function logOf(fn: () => Promise<unknown>) {
  const from = calls.length;
  await fn();
  return calls.slice(from).map((c) => `${c.meter} ${c.op} ${c.key}`);
}

describe('runDue', () => {
  it('claims inside the safety window when the tick flag is 0, and skips the claim when it is in the future', async () => {
    const owner = newOwner();
    const caller = device(owner);
    const claim = `redis eval rp:${owner}:plugins:due`;
    const flagRead = `blob-read flag tick-flag/${owner}.json`;

    // First tick: no window yet, so the real claim runs and starts it.
    expect(await logOf(() => runDue(caller))).toContain(claim);

    // 0 = "due within 10 minutes, check every tick".
    await setTickFlag(owner, 0);
    vi.setSystemTime(T0 + 30_000);
    const due = await logOf(() => runDue(caller));
    expect(due).toContain(flagRead);
    expect(due).toContain(claim);

    await setTickFlag(owner, T0 + 3_600_000);
    vi.setSystemTime(T0 + 60_000);
    let result: unknown;
    const idle = await logOf(async () => {
      result = await runDue(caller);
    });
    expect(idle).toContain(flagRead);
    expect(idle.filter((c) => c.startsWith('redis eval'))).toEqual([]);
    expect(result).toEqual({ results: [], idle: true });
  });
});

describe('job refs', () => {
  it('answers {gone: true} to an ack or nack for an owner the device no longer serves, touching nothing', async () => {
    const owner = newOwner();
    const left = newOwner(); // a member who left, or the printer's old owner
    const { id } = await createRawJob(left, rawJob);
    const ref = `${left}~${id}`;

    let results: unknown[] = [];
    const log = await logOf(async () => {
      results = [await ack(device(owner), ref), await nack(device(owner), ref)];
    });
    expect(results).toEqual([{ gone: true }, { gone: true }]);
    expect(log).toEqual([]);
    // Still waiting in its own owner's queue, untouched.
    expect(listOf(`rp:${left}:jobs:queue`)).toEqual([id]);
    expect((await listJobs(left))[0]).toMatchObject({ id, status: 'queued' });
  });

  it('answers 200 on both routes, so the firmware stops retrying the ack', async () => {
    for (const route of [ackRoute, nackRoute]) {
      const res = await route(
        new Request(`http://docket.test/x?job=${newOwner()}~job-1`, {
          method: 'POST',
          headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
          body: '',
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ gone: true });
    }
  });
});

// The queue flag as Blob holds it, and what another instance would do to it.
const queueFlag = (owner: string) => {
  const body = blobs.get(`queue-flag/${owner}.json`);
  return body ? JSON.parse(new TextDecoder().decode(body)).hasWork : undefined;
};
const setQueueFlag = (owner: string, hasWork: boolean) =>
  fakePut(`queue-flag/${owner}.json`, JSON.stringify({ hasWork }));
const flagWrites = (log: string[], owner: string) =>
  log.filter((c) => c === `blob-write put queue-flag/${owner}.json`);

describe('queue flag', () => {
  it('an empty claim clears a flag another instance set, though this instance last wrote false', async () => {
    const owner = newOwner();
    vi.setSystemTime(T0);
    await serveNext(device(owner)); // no flag yet: claims, writes false
    expect(queueFlag(owner)).toBe(false);

    await setQueueFlag(owner, true); // another instance, stale
    vi.setSystemTime(T0 + 5_000);
    const fix = await logOf(() => serveNext(device(owner)));
    expect(fix).toContain(`redis eval rp:${owner}:jobs:queue`);
    expect(flagWrites(fix, owner)).toHaveLength(1);
    expect(queueFlag(owner)).toBe(false);

    // Idle again: a flag read, no Redis.
    vi.setSystemTime(T0 + 10_000);
    const idle = await logOf(() => serveNext(device(owner)));
    expect(idle.filter((c) => c.startsWith('redis'))).toEqual([]);
  });

  it('enqueue sets a flag another instance cleared, though this instance last wrote true; an already-true flag costs no write', async () => {
    const owner = newOwner();
    expect(
      flagWrites(await logOf(() => createRawJob(owner, rawJob)), owner),
    ).toHaveLength(1);
    expect(queueFlag(owner)).toBe(true);
    expect(
      flagWrites(await logOf(() => createRawJob(owner, rawJob)), owner),
    ).toEqual([]);

    await setQueueFlag(owner, false); // another instance's late clear
    expect(
      flagWrites(await logOf(() => createRawJob(owner, rawJob)), owner),
    ).toHaveLength(1);
    expect(queueFlag(owner)).toBe(true);
  });

  it('a safety claim that finds work under a false flag sets it, so the next poll serves the rest', async () => {
    const owner = newOwner();
    const first = await createRawJob(owner, rawJob);
    const second = await createRawJob(owner, rawJob);
    await setQueueFlag(owner, false); // a raced or lost write

    vi.setSystemTime(T0 + 20 * 60_000); // past any safety window
    const served = await serveNext(device(owner));
    expect(served?.jobRef).toBe(`${owner}~${first.id}`);
    expect(queueFlag(owner)).toBe(true);

    vi.setSystemTime(T0 + 20 * 60_000 + 5_000); // inside the window
    expect((await serveNext(device(owner)))?.jobRef).toBe(
      `${owner}~${second.id}`,
    );
  });

  it('while the flag cannot be read, empty claims write it once, not on every poll', async () => {
    const owner = newOwner();
    const flagUrl = `https://${BLOB_HOST}/queue-flag/${owner}.json`;
    vi.stubGlobal('fetch', async (input: string | URL | Request) =>
      String(input).startsWith(flagUrl)
        ? new Response('unavailable', { status: 503 })
        : fetchStub(input),
    );
    try {
      const log: string[] = [];
      for (let i = 0; i < 3; i++) {
        vi.setSystemTime(T0 + 30 * 60_000 + i * 5_000);
        log.push(...(await logOf(() => serveNext(device(owner)))));
      }
      // Unknown flag: every poll claims, one write in all.
      expect(
        log.filter((c) => c === `redis eval rp:${owner}:jobs:queue`),
      ).toHaveLength(3);
      expect(flagWrites(log, owner)).toHaveLength(1);
    } finally {
      vi.stubGlobal('fetch', fetchStub);
    }
  });
});

describe('a job that keeps failing', () => {
  it('goes back to the front for 2 nacks, then waits behind later jobs; every nack counts', async () => {
    const owner = newOwner();
    const caller = device(owner);
    const stuck = await createRawJob(owner, rawJob);
    const later = await createRawJob(owner, rawJob);
    const ref = (id: string) => `${owner}~${id}`;
    let t = T0 + 40 * 60_000;
    const poll = async () => {
      t += 5_000;
      vi.setSystemTime(t);
      return (await serveNext(caller))?.jobRef;
    };

    for (const n of [1, 2]) {
      expect(await poll()).toBe(ref(stuck.id));
      expect(await nack(caller, ref(stuck.id))).toEqual({
        requeued: ref(stuck.id),
        found: true,
      });
      expect(listOf(`rp:${owner}:jobs:queue`)).toEqual([stuck.id, later.id]);
      const listed = await listJobs(owner, 20, { attempts: true });
      expect(listed.find((j) => j.id === stuck.id)).toMatchObject({
        status: 'queued',
        attempts: n,
      });
    }

    expect(await poll()).toBe(ref(stuck.id));
    await nack(caller, ref(stuck.id)); // the 3rd: to the back
    expect(listOf(`rp:${owner}:jobs:queue`)).toEqual([later.id, stuck.id]);
    expect(await poll()).toBe(ref(later.id));
    await ack(caller, ref(later.id));
    expect(await poll()).toBe(ref(stuck.id));
    await nack(caller, ref(stuck.id));

    const listed = await listJobs(owner, 20, { attempts: true });
    expect(
      Object.fromEntries(listed.map((j) => [j.id, [j.status, j.attempts]])),
    ).toEqual({ [later.id]: ['done', 0], [stuck.id]: ['queued', 4] });
    // Without the flag, no attempts and no queue read.
    const plain = await logOf(() => listJobs(owner));
    expect(plain.filter((c) => c.startsWith('redis'))).toEqual([]);
    expect((await listJobs(owner))[0]).not.toHaveProperty('attempts');
  });
});

describe('the Queue view, hosted', () => {
  it('lists a job at the back where it will print, from one LRANGE sent only then', async () => {
    const owner = newOwner();
    const caller = device(owner);
    const user = userCaller({ userId: owner, role: 'user' });
    const ref = (id: string) => `${owner}~${id}`;
    const ids = async () => (await queueData(user)).jobs.map((j) => j.id);
    const lranges = (log: string[]) =>
      log.filter((c) => c.startsWith('redis lrange'));
    const a = (await createRawJob(owner, rawJob)).id;
    const b = (await createRawJob(owner, rawJob)).id;
    let t = T0 + 50 * 60_000;
    const poll = async () => {
      t += 5_000;
      vi.setSystemTime(t);
      return (await serveNext(caller))?.jobRef;
    };

    expect(await poll()).toBe(ref(a));
    await nack(caller, ref(a)); // one failure: back at the front
    expect(lranges(await logOf(ids))).toEqual([]);
    expect(await poll()).toBe(ref(a));
    await nack(caller, ref(a));
    expect(await poll()).toBe(ref(a));
    await nack(caller, ref(a)); // the 3rd: to the back
    const c = (await createRawJob(owner, rawJob)).id;
    expect(listOf(`rp:${owner}:jobs:queue`)).toEqual([b, a, c]);

    let listed: string[] = [];
    const log = await logOf(async () => {
      listed = await ids();
    });
    expect(listed).toEqual([b, a, c]);
    expect(lranges(log)).toEqual([`redis lrange rp:${owner}:jobs:queue`]);
  });
});

describe('pairing, hosted', () => {
  it('an owner re-pairing their printer keeps its members in the token mirror', async () => {
    const owner = newOwner();
    const member = newOwner();
    const hardwareId = `hw-${randomUUID()}`;
    const first = (await beginPairing(hardwareId)).code;
    const claimed = await claimDevice(owner, first, 'kitchen');
    if (!claimed || 'taken' in claimed) throw new Error('claim failed');
    await pollPairing(hardwareId, first);
    const share = await mintShareCode(owner, claimed.id);
    await joinDevice(member, share?.code as string);

    const again = (await beginPairing(hardwareId)).code;
    expect(await claimDevice(owner, again, 'kitchen')).toEqual({
      id: claimed.id,
      name: 'kitchen',
    });
    const { token } = (await pollPairing(hardwareId, again)) ?? {};
    expect(await resolveDeviceToken(token as string)).toEqual({
      ownerId: owner,
      deviceId: claimed.id,
      owners: [owner, member],
    });
  });
});

describe('callers', () => {
  it('refuses a user caller on serveNext before touching any store', async () => {
    const owner = newOwner();
    let err: unknown;
    const log = await logOf(async () => {
      err = await serveNext(userCaller({ userId: owner, role: 'admin' })).catch(
        (e) => e,
      );
    });
    expect(err).toMatchObject({ name: 'OpError', code: 'forbidden' });
    expect(log).toEqual([]);
  });

  it('maps an unauthenticated OpError to 500, never 401', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = deviceErrorResponse(
        new OpError('unauthenticated', 'sign in required'),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'server error' });
    } finally {
      logged.mockRestore();
    }
  });
});
