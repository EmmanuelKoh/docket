// tests/ops/printers.test.ts — the printer ops (lib/ops/printers.js): a
// typed code claims a pairing code, else joins with a share code, and the
// list that follows is JSON (dates as ISO strings), with the hardware id
// on the owner's row only; a pairing code from a printer paired to
// another account is refused until its owner revokes it, and then the
// printer changes hands without the old members; a new pairing code
// voids a claimed token the printer has not collected, and a claim whose
// code is replaced mid-claim loses; presence reads the
// printer's primary owner's slot, so a member sees the shared printer's
// heartbeat; the Printer page's overview lists devices once; and the
// /api/devices DELETE dispatch, which the ops never see.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DELETE, POST } from '@/app/api/devices/route';
import { user } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { beginPairing, listDevices, pollPairing } from '@/lib/devices.js';
import { userCaller } from '@/lib/ops/caller.js';
import { serveNext } from '@/lib/ops/device-service.js';
import { callerForDeviceToken } from '@/lib/ops/identity.js';
import {
  printersEnterCode,
  printersList,
  printersOverview,
  printersRevoke,
  printersShare,
  printersStatus,
} from '@/lib/ops/printers.js';
import { getState, setState } from '@/lib/state-store.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-printers`;
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));
// Counted, not changed: printers.overview must list devices once.
vi.mock('@/lib/devices.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/devices.js')>();
  return { ...real, listDevices: vi.fn(real.listDevices) };
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// An account (the member list joins user rows for emails) and its caller.
async function account() {
  const id = `owner-${randomUUID()}`;
  const db = await getDb();
  await db.insert(user).values({ id, name: id, email: `${id}@docket.test` });
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}

// A printer paired the real way: the device asks for a code, the owner
// types it (lower case, padded, as people do), the device collects its
// token. Returns the device id and token.
async function pairedPrinter(owner: Awaited<ReturnType<typeof account>>) {
  const hardwareId = `hw-${randomUUID()}`;
  const { code } = await beginPairing(hardwareId);
  const claimed = await printersEnterCode(owner.caller, {
    code: ` ${code.toLowerCase()} `,
    name: 'kitchen',
  });
  expect(claimed).toEqual({
    device: { id: expect.any(String), name: 'kitchen' },
  });
  const collected = await pollPairing(hardwareId, code);
  return {
    id: claimed.device.id,
    token: collected?.token as string,
    hardwareId,
  };
}

// A member joined through a fresh share code.
async function join(
  owner: Awaited<ReturnType<typeof account>>,
  member: Awaited<ReturnType<typeof account>>,
  id: string,
) {
  const { code } = await printersShare(owner.caller, { id });
  return printersEnterCode(member.caller, { code });
}

describe('printers.enterCode and printers.list', () => {
  it('claims a pairing code, else joins with a share code; the lists that follow are JSON', async () => {
    const owner = await account();
    const member = await account();
    const { id } = await pairedPrinter(owner);

    // Owner view with a live share code: both dates come back as strings
    // (the op's JSON check would throw on a Date).
    const share = await printersShare(owner.caller, { id });
    expect(share).toEqual({ code: expect.any(String), ttlSeconds: 900 });
    const [own] = await printersList(owner.caller);
    expect(own).toMatchObject({
      id,
      name: 'kitchen',
      role: 'owner',
      primaryOwnerId: owner.id,
      shareCode: share.code,
      members: [],
    });
    expect(own.hardwareId).toEqual(expect.any(String));
    expect(Date.parse(own.pairedAt)).not.toBeNaN();
    expect(Date.parse(own.shareCodeExpiresAt)).toBeGreaterThan(Date.now());

    // Not a pairing code, so the share code joins.
    expect(
      await printersEnterCode(member.caller, { code: share.code }),
    ).toEqual({ device: { id, name: 'kitchen' }, joined: true });

    const [after] = await printersList(owner.caller);
    expect(after.shareCode).toBeNull(); // single use
    expect(after.members).toEqual([
      { ownerId: member.id, email: `${member.id}@docket.test` },
    ]);
    // No hardwareId for a member: with it, /pair would hand them a code
    // that re-pairs the owner's printer.
    const shared = await printersList(member.caller);
    expect(shared).toEqual([
      {
        id,
        name: 'kitchen',
        pairedAt: own.pairedAt,
        primaryOwnerId: owner.id,
        role: 'member',
        shareCode: null,
        members: [],
      },
    ]);
    expect(JSON.parse(JSON.stringify(shared))).toEqual(shared);
  });

  it('refuses a used, unknown or blank code', async () => {
    const owner = await account();
    const member = await account();
    const { id } = await pairedPrinter(owner);
    const { code } = await printersShare(owner.caller, { id });
    await printersEnterCode(member.caller, { code });

    for (const used of [code, 'ZZZZZZ']) {
      await expect(
        printersEnterCode(member.caller, { code: used }),
      ).rejects.toMatchObject({
        code: 'not_found',
        message: 'code not recognized or expired',
      });
    }
    await expect(
      printersEnterCode(member.caller, { code: '  ' }),
    ).rejects.toMatchObject({ code: 'invalid', message: 'code required' });
  });
});

describe('pairing a printer paired to another account', () => {
  const TAKEN =
    'This printer belongs to another account. Its owner can remove it on their Printer page.';
  // The printer prints a fresh code (it lost its token, or someone holding
  // it asked /pair, which hands the code to anyone with the hardware id).
  const newCode = async (hardwareId: string) =>
    (await beginPairing(hardwareId)).code;
  const enterCode = (who: string, code: string) =>
    POST(
      new Request('http://docket.test/api/devices', {
        method: 'POST',
        headers: { 'x-test-user': `${who}:user` },
        body: JSON.stringify({ code }),
      }),
    );

  it('refuses another account with conflict; the owner may re-pair and keeps the members', async () => {
    const owner = await account();
    const member = await account();
    const other = await account();
    const { id, token, hardwareId } = await pairedPrinter(owner);
    await join(owner, member, id);

    const code = await newCode(hardwareId);
    await expect(
      printersEnterCode(other.caller, { code }),
    ).rejects.toMatchObject({
      name: 'OpError',
      code: 'conflict',
      message: TAKEN,
    });
    const res = await enterCode(other.id, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: TAKEN });
    // A member is another account too.
    await expect(
      printersEnterCode(member.caller, { code }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Nothing changed: the old token still serves owner and member.
    expect(await printersList(other.caller)).toEqual([]);
    expect((await callerForDeviceToken(token))?.actor).toMatchObject({
      owners: [owner.id, member.id],
    });

    // The owner re-pairs their own printer: a new token, same members.
    expect(await printersEnterCode(owner.caller, { code })).toEqual({
      device: { id, name: 'printer' },
    });
    const fresh = await pollPairing(hardwareId, code);
    expect(await callerForDeviceToken(token)).toBeNull();
    expect(
      (await callerForDeviceToken(fresh?.token as string))?.actor,
    ).toMatchObject({ owners: [owner.id, member.id] });
  });

  it('after a revoke the printer goes to the new account without the old members or share code', async () => {
    const owner = await account();
    const member = await account();
    const other = await account();
    const { id, hardwareId } = await pairedPrinter(owner);
    await join(owner, member, id);
    await printersShare(owner.caller, { id }); // a live share code

    expect(await printersRevoke(owner.caller, { id })).toEqual({ ok: true });
    const code = await newCode(hardwareId);
    expect(
      await printersEnterCode(other.caller, { code, name: 'desk' }),
    ).toEqual({
      device: { id, name: 'desk' },
    });
    const collected = await pollPairing(hardwareId, code);

    const [mine] = await printersList(other.caller);
    expect(mine).toMatchObject({
      id,
      role: 'owner',
      shareCode: null,
      members: [],
    });
    expect(await printersList(owner.caller)).toEqual([]);
    expect(await printersList(member.caller)).toEqual([]);
    expect(
      (await callerForDeviceToken(collected?.token as string))?.actor,
    ).toMatchObject({ owners: [other.id] });
  });

  it("lets another account claim a printer whose owner's account is gone", async () => {
    const owner = await account();
    const other = await account();
    const { id, hardwareId } = await pairedPrinter(owner);
    const db = await getDb();
    await db.delete(user).where(eq(user.id, owner.id));

    const code = await newCode(hardwareId);
    expect(await printersEnterCode(other.caller, { code })).toEqual({
      device: { id, name: 'printer' },
    });
  });
});

describe('a new code before the printer collects its token', () => {
  const TAKEN =
    'This printer belongs to another account. Its owner can remove it on their Printer page.';

  it('voids the claimed token: no one collects it, and only the owner can claim again', async () => {
    const owner = await account();
    const other = await account();
    const hardwareId = `hw-${randomUUID()}`;
    const first = (await beginPairing(hardwareId)).code;
    const { device } = await printersEnterCode(owner.caller, { code: first });

    // Before the printer polls, anyone who knows the hardware id asks
    // /pair: the reply carries a fresh code.
    const second = (await beginPairing(hardwareId)).code;
    expect(await pollPairing(hardwareId, second)).toBeNull();
    expect(await pollPairing(hardwareId, first)).toBeNull();
    await expect(
      printersEnterCode(other.caller, { code: second }),
    ).rejects.toMatchObject({ code: 'conflict', message: TAKEN });

    // The printer prints that code; the owner enters it, and the printer
    // collects a working token.
    expect(await printersEnterCode(owner.caller, { code: second })).toEqual({
      device,
    });
    const { token } = (await pollPairing(hardwareId, second)) ?? {};
    expect((await callerForDeviceToken(token as string))?.actor).toMatchObject({
      owners: [owner.id],
    });
  });

  it("loses a claim whose code was replaced between the claim's read and its write", async () => {
    const owner = await account();
    const hardwareId = `hw-${randomUUID()}`;
    const first = (await beginPairing(hardwareId)).code;
    let second = '';
    await beforeNextUpdate(
      async () => {
        second = (await beginPairing(hardwareId)).code;
      },
      () =>
        expect(
          printersEnterCode(owner.caller, { code: first }),
        ).rejects.toMatchObject({ code: 'not_found' }),
    );
    expect(second).not.toBe('');
    expect(await pollPairing(hardwareId, second)).toBeNull();
    expect(await pollPairing(hardwareId, first)).toBeNull();
    expect(await printersList(owner.caller)).toEqual([]);
  });
});

// Runs `fn` with the database wrapped so that `between` runs once, just
// before the first UPDATE that `fn` sends reaches the database: a claim
// has read its code row, and has not written yet.
async function beforeNextUpdate(
  between: () => Promise<void>,
  fn: () => Promise<unknown>,
) {
  const g = globalThis as { __docketDbPromise?: Promise<unknown> };
  const real = (await getDb()) as object;
  const saved = g.__docketDbPromise;
  let armed = true;
  const delayed = (target: object): object =>
    new Proxy(target, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p === 'then') {
          return (ok: (x: unknown) => unknown, fail: (e: unknown) => unknown) =>
            between().then(
              () => (t as PromiseLike<unknown>).then(ok, fail),
              fail,
            );
        }
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          const out = v.apply(t, args);
          return out && typeof out === 'object' ? delayed(out) : out;
        };
      },
    });
  g.__docketDbPromise = Promise.resolve(
    new Proxy(real, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p === 'update' && armed) {
          armed = false;
          return (...args: unknown[]) => delayed(v.apply(t, args));
        }
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }),
  );
  try {
    await fn();
    expect(armed).toBe(false);
  } finally {
    g.__docketDbPromise = saved;
  }
}

describe('printers.status', () => {
  it("a member sees the primary owner's heartbeat, by the 90-second rule", async () => {
    const owner = await account();
    const member = await account();
    const loner = await account();
    const { id, token } = await pairedPrinter(owner);
    await join(owner, member, id);

    // The device polls: its one heartbeat lands on the primary owner's slot.
    const device = await callerForDeviceToken(token);
    expect(device?.actor).toMatchObject({ owners: [owner.id, member.id] });
    await serveNext(device);
    await vi.waitFor(async () => {
      expect((await printersStatus(member.caller)).online).toBe(true);
    });
    const seen = await printersStatus(owner.caller);
    expect(seen).toEqual({ lastSeenAt: expect.any(String), online: true });
    expect(await printersStatus(member.caller)).toEqual(seen);
    // The member's own slot stays empty: reading it says "offline".
    expect(await getState(member.id, 'device')).toBeNull();

    const stale = new Date(Date.now() - 91_000).toISOString();
    await setState(owner.id, 'device', { lastSeenAt: stale });
    expect(await printersStatus(member.caller)).toEqual({
      lastSeenAt: stale,
      online: false,
    });

    expect(await printersStatus(loner.caller)).toEqual({
      lastSeenAt: null,
      online: false,
    });
  });
});

describe('printers.overview', () => {
  it('answers printers.list and printers.status from one device listing', async () => {
    const owner = await account();
    const member = await account();
    const { id } = await pairedPrinter(owner);
    await join(owner, member, id);
    const seen = new Date().toISOString();
    await setState(owner.id, 'device', { lastSeenAt: seen });

    for (const who of [owner, member]) {
      const listings = vi.mocked(listDevices).mock.calls.length;
      const overview = await printersOverview(who.caller);
      expect(vi.mocked(listDevices).mock.calls.length - listings).toBe(1);
      expect(overview).toEqual({
        devices: await printersList(who.caller),
        status: await printersStatus(who.caller),
      });
      expect(overview.status).toEqual({ lastSeenAt: seen, online: true });
    }
  });
});

describe('DELETE /api/devices', () => {
  const request = (query: string, who?: string) =>
    new Request(`http://docket.test/api/devices${query}`, {
      method: 'DELETE',
      headers: who ? { 'x-test-user': `${who}:user` } : {},
    });
  const call = async (query: string, who?: string) => {
    const res = await DELETE(request(query, who));
    return { status: res.status, body: await res.json() };
  };
  const ids = async (a: Awaited<ReturnType<typeof account>>) =>
    (await printersList(a.caller)).map((d) => d.id);

  it('dispatches ?member= to removeMember, ?leave to leave, and a bare id to revoke', async () => {
    const owner = await account();
    const member = await account();
    const { id } = await pairedPrinter(owner);
    const q = `?id=${encodeURIComponent(id)}`;

    await join(owner, member, id);
    expect(await call(`${q}&member=${member.id}`, owner.id)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(await ids(member)).toEqual([]);

    await join(owner, member, id);
    // leave acts on the caller's own membership: the owner has none.
    expect((await call(`${q}&leave`, owner.id)).status).toBe(404);
    expect((await call(`${q}&leave`, member.id)).status).toBe(200);
    expect(await ids(member)).toEqual([]);

    // A member cannot revoke; the owner can.
    await join(owner, member, id);
    expect((await call(q, member.id)).status).toBe(404);
    expect(await ids(owner)).toEqual([id]);
    expect((await call(q, owner.id)).status).toBe(200);
    expect(await ids(owner)).toEqual([]);
    expect(await ids(member)).toEqual([]);
  });

  it('answers 400 without an id and 401 without a session', async () => {
    const owner = await account();
    expect(await call('', owner.id)).toEqual({
      status: 400,
      body: { error: 'id required' },
    });
    expect(await call('?id=x')).toEqual({
      status: 401,
      body: { error: 'sign in required' },
    });
    const res = await POST(
      new Request('http://docket.test/api/devices', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABCDEF' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
