// tests/ops/accounts.test.ts — the account ops (lib/ops/accounts.js): the
// four admin ops refuse everyone but an admin and write nothing when they
// do; an admin's invite list is JSON (dates as ISO strings) and drops
// revoked links; users.create maps Better Auth's refusals to op errors;
// and invites.check, which anyone may call, refuses a link once it is used
// or expired. A sign-up the endpoint refuses (bad email, password length,
// an existing account) leaves the invite open; without an open invite
// every sign-up gets the invite refusal, never an account-existence hint.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { invite, user } from '@/db/schema.js';
import { getAuth } from '@/lib/auth-server.js';
import { getDb } from '@/lib/db.js';
import {
  invitesCheck,
  invitesCreate,
  invitesRevoke,
  usersCreate,
  usersList,
} from '@/lib/ops/accounts.js';
import { systemCaller, tokenCaller, userCaller } from '@/lib/ops/caller.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-accounts`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const admin = () =>
  userCaller({ userId: `owner-${randomUUID()}`, role: 'admin' });
const email = () => `${randomUUID()}@docket.test`;

async function inviteRow(token: string) {
  const db = await getDb();
  const [row] = await db.select().from(invite).where(eq(invite.token, token));
  return row ?? null;
}

async function userRows(address: string) {
  const db = await getDb();
  return db.select().from(user).where(eq(user.email, address));
}

describe('admin ops', () => {
  it('a non-admin user gets forbidden on all four admin ops and nothing is written', async () => {
    const { token } = await invitesCreate(admin(), {});
    const address = email();
    const calls = {
      'users.list': (c: Parameters<typeof usersList>[0]) => usersList(c),
      'users.create': (c: Parameters<typeof usersCreate>[0]) =>
        usersCreate(c, { name: 'x', email: address, password: 'long-enough' }),
      'invites.create': (c: Parameters<typeof invitesCreate>[0]) =>
        invitesCreate(c, { email: address }),
      'invites.revoke': (c: Parameters<typeof invitesRevoke>[0]) =>
        invitesRevoke(c, { token }),
    };
    const nonAdmins = [
      userCaller({ userId: `owner-${randomUUID()}`, role: 'user' }),
      systemCaller(`owner-${randomUUID()}`, 'cli:test'), // scripts get owner rights only
      tokenCaller(`owner-${randomUUID()}`, 'message-ingest:ingestToken', [
        'read',
      ]),
    ];
    for (const [name, call] of Object.entries(calls)) {
      for (const caller of nonAdmins) {
        await expect(call(caller), name).rejects.toMatchObject({
          name: 'OpError',
          code: 'forbidden',
        });
      }
      await expect(call(null), name).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    }

    expect(await inviteRow(token)).not.toBeNull(); // not revoked
    expect(await userRows(address)).toEqual([]); // no account
    const listed = await usersList(admin());
    expect(listed.invites.filter((i) => i.email === address)).toEqual([]);
  });

  it('an admin mints, lists and revokes invites; the list is JSON', async () => {
    const a = admin();
    const pinnedTo = email();
    const pinned = await invitesCreate(a, { email: `  ${pinnedTo} ` });
    const open = await invitesCreate(a, { email: '' });
    expect(pinned).toEqual({ token: expect.any(String) });
    expect((await inviteRow(pinned.token))?.createdBy).toBe(a.actor.id);
    // Two inserts in the same millisecond tie on created_at; backdate the
    // older one so "newest first" is decided.
    const db = await getDb();
    await db
      .update(invite)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(invite.token, pinned.token));

    const list = await usersList(a);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    const mine = list.invites.filter((i) =>
      [pinned.token, open.token].includes(i.token),
    );
    expect(mine).toEqual([
      // newest first
      { token: open.token, email: null, expiresAt: expect.any(String) },
      { token: pinned.token, email: pinnedTo, expiresAt: expect.any(String) },
    ]);
    const days = (Date.parse(mine[0].expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    expect(await invitesRevoke(a, { token: open.token })).toEqual({
      ok: true,
    });
    expect(await inviteRow(open.token)).toBeNull();
    // Revoking again is not an error; a blank token is.
    expect(await invitesRevoke(a, { token: open.token })).toEqual({
      ok: true,
    });
    await expect(invitesRevoke(a, { token: '' })).rejects.toMatchObject({
      code: 'invalid',
      message: 'token query parameter is required',
    });
    const after = await usersList(a);
    expect(after.invites.map((i) => i.token)).toContain(pinned.token);
    expect(after.invites.map((i) => i.token)).not.toContain(open.token);
  });

  it('users.create makes the account; a taken email is conflict, a short password invalid', async () => {
    const a = admin();
    const address = email();
    const created = await usersCreate(a, {
      name: 'Pat',
      email: address,
      password: 'long-enough',
    });
    expect(created).toEqual({
      user: {
        id: expect.any(String),
        name: 'Pat',
        email: address,
        role: 'user',
      },
    });
    const listed = (await usersList(a)).users.find((u) => u.email === address);
    expect(listed).toEqual({
      id: created.user.id,
      name: 'Pat',
      email: address,
      role: 'user',
      createdAt: expect.any(String),
    });

    await expect(
      usersCreate(a, { name: 'Pat', email: address, password: 'long-enough' }),
    ).rejects.toMatchObject({ name: 'OpError', code: 'conflict' });
    await expect(
      usersCreate(a, { name: 'Pat', email: email(), password: 'short' }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'password must be at least 8 characters',
    });
  });
});

describe('invites.check', () => {
  it('answers an open link for anyone and refuses it once used or expired', async () => {
    const a = admin();
    const pinnedTo = email();
    const used = await invitesCreate(a, { email: pinnedTo });
    const expired = await invitesCreate(a, {});
    const fresh = await invitesCreate(a, {});

    // Signed out (null caller): the invite page's case.
    expect(await invitesCheck(null, { token: used.token })).toEqual({
      email: pinnedTo,
    });
    expect(await invitesCheck(null, { token: fresh.token })).toEqual({
      email: null,
    });

    // A real sign-up claims the link (the before-hook in lib/auth-server.js).
    const auth = await getAuth();
    await auth.api.signUpEmail({
      body: {
        name: 'New',
        email: pinnedTo,
        password: 'long-enough',
        inviteToken: used.token,
      } as Parameters<typeof auth.api.signUpEmail>[0]['body'],
    });
    expect((await inviteRow(used.token))?.usedAt).toBeInstanceOf(Date);

    const db = await getDb();
    await db
      .update(invite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invite.token, expired.token));

    for (const token of [used.token, expired.token, 'no-such-token']) {
      await expect(invitesCheck(null, { token }), token).rejects.toMatchObject({
        name: 'OpError',
        code: 'not_found',
        message: 'invite is invalid, already used, or expired',
      });
    }
    // Used and expired links are not listed as open either.
    const open = (await usersList(a)).invites.map((i) => i.token);
    expect(open).toContain(fresh.token);
    expect(open).not.toContain(used.token);
    expect(open).not.toContain(expired.token);
  });
});

describe('invite sign-up', () => {
  const NO_ENTRY =
    'signup is by invitation — this link is invalid, already used, or expired';

  async function signUp(token: string, fields: Record<string, string>) {
    const auth = await getAuth();
    return auth.api
      .signUpEmail({
        body: {
          name: 'New',
          password: 'long-enough',
          ...fields,
          inviteToken: token,
        } as Parameters<typeof auth.api.signUpEmail>[0]['body'],
      })
      .then(
        () => null,
        (err) => err,
      );
  }

  it('a refused sign-up leaves the invite open, so the link still works', async () => {
    const a = admin();
    const taken = email();
    await usersCreate(a, {
      name: 'Pat',
      email: taken,
      password: 'long-enough',
    });
    const { token } = await invitesCreate(a, {});
    const address = email();

    const refusals: [Record<string, string>, number, string, string][] = [
      [
        { email: address, password: 'short' },
        400,
        'PASSWORD_TOO_SHORT',
        'Password too short',
      ],
      [
        { email: address, password: 'x'.repeat(129) },
        400,
        'PASSWORD_TOO_LONG',
        'Password too long',
      ],
      [{ email: 'not-an-email' }, 400, 'INVALID_EMAIL', 'Invalid email'],
      [
        { email: taken },
        422,
        'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        'User already exists. Use another email.',
      ],
      [
        { email: taken.toUpperCase() },
        422,
        'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        'User already exists. Use another email.',
      ],
    ];
    for (const [fields, statusCode, code, message] of refusals) {
      const err = await signUp(token, fields);
      expect(err, code).toMatchObject({
        name: 'APIError',
        statusCode,
        body: { code, message },
      });
      expect((await inviteRow(token))?.usedAt, code).toBeNull();
      expect(await invitesCheck(null, { token }), code).toEqual({
        email: null,
      });
    }
    expect(await userRows(address)).toEqual([]);

    // The same link then makes the account, once.
    expect(await signUp(token, { email: address })).toBeNull();
    expect((await inviteRow(token))?.usedAt).toBeInstanceOf(Date);
    expect(await userRows(address)).toHaveLength(1);
    expect(await signUp(token, { email: email() })).toMatchObject({
      statusCode: 403,
      body: { message: NO_ENTRY },
    });
  });

  it('without an open invite the refusal is the invite one, whatever else is wrong', async () => {
    const a = admin();
    const taken = email();
    await usersCreate(a, {
      name: 'Pat',
      email: taken,
      password: 'long-enough',
    });
    const pinnedTo = email();
    const pinned = await invitesCreate(a, { email: pinnedTo });

    for (const [token, fields] of [
      ['no-such-token', { email: taken }],
      ['no-such-token', { email: email(), password: 'short' }],
      [pinned.token, { email: taken }], // pinned to another address
      [pinned.token, { email: email() }],
    ] as [string, Record<string, string>][]) {
      expect(await signUp(token, fields), token).toMatchObject({
        statusCode: 403,
        body: { message: NO_ENTRY },
      });
    }
    // The pinned link is still open for its own address.
    expect((await inviteRow(pinned.token))?.usedAt).toBeNull();
    expect(await signUp(pinned.token, { email: pinnedTo })).toBeNull();
    expect((await inviteRow(pinned.token))?.usedAt).toBeInstanceOf(Date);
  });
});
