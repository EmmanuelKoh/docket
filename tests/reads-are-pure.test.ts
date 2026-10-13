// tests/reads-are-pure.test.ts — reads never write. Template, slip and
// take reads leave the stores as they found them; seeding and purging are
// explicit: starter templates once at account creation (the Better Auth
// user-create hook in lib/auth-server.js), plugin registration on the
// Slips pages, tombstone purges in the takes list route.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { listSlips } from '@/app/_lib/slip-data';
import { DATA_DIR } from '@/config.js';
import { invite, tapeTake, template, user } from '@/db/schema.js';
import { getAuth } from '@/lib/auth-server.js';
import { getDb } from '@/lib/db.js';
import { userCaller } from '@/lib/ops/caller.js';
import {
  getTemplates,
  saveTemplate,
  seedStarterTemplates,
} from '@/lib/store.js';
import {
  createTake,
  deleteTake,
  listTakes,
  purgeTakes,
} from '@/lib/tape-store.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/reads-are-pure`;
});

// Production's adapter config (neon-http) has no transactions, so Better
// Auth runs a sign-up's "transaction" as plain statements. Give it PGlite's
// real ones here, so a failed sign-up rolls its user row back before the
// after-hook runs: the case the hook's user-row check is for.
vi.mock('better-auth/adapters/drizzle', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('better-auth/adapters/drizzle')>();
  type Args = Parameters<typeof mod.drizzleAdapter>;
  return {
    ...mod,
    drizzleAdapter: (db: Args[0], config: Args[1]) =>
      mod.drizzleAdapter(db, { ...config, transaction: true }),
  };
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;
const STARTERS: string[] = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'reference', 'starter-templates.json'),
    'utf8',
  ),
).map((t: { name: string }) => t.name);

async function templateRows(ownerId?: string) {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(template)
    .where(ownerId ? eq(template.ownerId, ownerId) : undefined);
  return row.n;
}

const names = (list: { name: string }[]) => list.map((t) => t.name).sort();

describe('templates', () => {
  it('getTemplates for a fresh owner returns [] and inserts nothing', async () => {
    const o = owner();
    expect(await getTemplates(o)).toEqual([]);
    expect(await templateRows(o)).toBe(0);
  });

  it('seedStarterTemplates seeds the starter set once, and only into an empty account', async () => {
    const o = owner();
    expect(STARTERS).toHaveLength(4);
    expect(await seedStarterTemplates(o)).toBe(STARTERS.length);
    expect(names(await getTemplates(o))).toEqual([...STARTERS].sort());
    expect(await seedStarterTemplates(o)).toBe(0);
    expect(await templateRows(o)).toBe(STARTERS.length);

    const other = owner();
    await saveTemplate(other, { name: 'Mine', template: '<div>x</div>' });
    expect(await seedStarterTemplates(other)).toBe(0);
    expect(names(await getTemplates(other))).toEqual(['Mine']);
  });
});

describe('slips', () => {
  it('listSlips for an unregistered owner writes no plugin records', async () => {
    const file = path.join(DATA_DIR, 'plugins.json');
    const snapshot = () =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const before = snapshot();
    const caller = userCaller({ userId: owner(), role: 'user' });
    expect(await listSlips(caller)).toEqual([]);
    expect(snapshot()).toBe(before);
  });
});

describe('tape takes', () => {
  it('listTakes keeps an expired tombstone; purgeTakes removes it and its payload', async () => {
    const o = owner();
    const take = await createTake(o, {
      name: 'Old',
      seconds: 1,
      sampleRate: 22050,
      noteCount: 0,
      payload: { doc: {} },
    });
    await deleteTake(o, take.id);
    const db = await getDb();
    const longAgo = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await db
      .update(tapeTake)
      .set({ deletedAt: longAgo })
      .where(eq(tapeTake.id, take.id));
    const doc = path.join(DATA_DIR, 'tape', o, `${take.id}.json`);
    const rowExists = async () =>
      (await db.select().from(tapeTake).where(eq(tapeTake.id, take.id)))
        .length === 1;

    expect(await listTakes(o)).toEqual([]);
    expect(await rowExists()).toBe(true);
    expect(fs.existsSync(doc)).toBe(true);

    expect(await purgeTakes(o)).toBe(1);
    expect(await rowExists()).toBe(false);
    expect(fs.existsSync(doc)).toBe(false);
  });
});

describe('starter templates at account creation', () => {
  const password = 'correct-horse-battery';

  it('createUser leaves the new user with the starter templates', async () => {
    const auth = await getAuth();
    const { user: u } = await auth.api.createUser({
      body: { name: 'New', email: `${randomUUID()}@example.test`, password },
    });
    expect(names(await getTemplates(u.id))).toEqual([...STARTERS].sort());
  });

  it('a sign-up whose transaction fails leaves no template rows', async () => {
    const auth = await getAuth();
    const db = await getDb();
    const token = randomUUID();
    const email = `${randomUUID()}@example.test`;
    await db.insert(invite).values({
      token,
      createdBy: 'test',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    // The user row goes in, then the account insert fails: the sign-up
    // transaction rolls back and the after-hook still runs.
    await db.execute(sql`
      create function fail_account() returns trigger language plpgsql as $$
      begin raise exception 'account insert refused (test)'; end $$`);
    await db.execute(sql`
      create trigger fail_account before insert on account
      for each row execute function fail_account()`);
    const before = await templateRows();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        auth.api.signUpEmail({
          body: {
            name: 'Failed',
            email,
            password,
            ...({ inviteToken: token } as Record<string, string>),
          },
        }),
      ).rejects.toThrow();
    } finally {
      quiet.mockRestore();
      await db.execute(sql`drop trigger fail_account on account`);
      await db.execute(sql`drop function fail_account()`);
    }
    expect(await db.select().from(user).where(eq(user.email, email))).toEqual(
      [],
    );
    expect(await templateRows()).toBe(before);
  });
});
