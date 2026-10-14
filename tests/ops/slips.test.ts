// tests/ops/slips.test.ts — the slip ops (lib/ops/slips.js) where they hold
// logic: slips.list pairs every installed module with the owner's record;
// slips.saveConfig validates before it writes (invalid input saves nothing)
// and merges submitted keys, so a credential the form leaves out survives;
// slips.printTest finds a slip's primary template and queues one job.
// Credential values reach only a signed-in user: a token with a 'read'
// grant, or a script, gets each record without them.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { systemCaller, tokenCaller, userCaller } from '@/lib/ops/caller.js';
import { callerForCredential } from '@/lib/ops/identity.js';
import { jobsList } from '@/lib/ops/jobs.js';
import {
  slipsGet,
  slipsList,
  slipsPrintTest,
  slipsRegister,
  slipsSaveConfig,
  slipsSetEnabled,
} from '@/lib/ops/slips.js';
import { templatesSave } from '@/lib/ops/templates.js';
import {
  getPlugin,
  getPluginConfig,
  isCredentialShape,
} from '@/lib/plugin-registry.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/job-kind.test.ts does), so a developer's .env cannot change what
// renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-slips`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const INGEST = 'message-ingest';

function account() {
  const id = `owner-${randomUUID()}`;
  return { id, caller: userCaller({ userId: id, role: 'user' }) };
}

// An owner after their first Slips visit.
async function registered() {
  const a = account();
  await slipsRegister(a.caller);
  return a;
}

// The record in the driver store and the Postgres config truth.
async function stored(owner: string, id: string) {
  const record = await getPlugin(owner, id);
  const truth = await getPluginConfig(owner, id);
  return {
    enabled: record?.enabled,
    schedule: record?.schedule,
    config: record?.config,
    truth: {
      enabled: truth?.enabled,
      schedule: truth?.schedule,
      config: truth?.config,
    },
  };
}

describe('slips.list', () => {
  it('pairs every installed module with the owner record, null before registration', async () => {
    const a = account();
    const before = await slipsList(a.caller);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((p) => p.record === null)).toBe(true);

    await slipsRegister(a.caller);
    const pairs = await slipsList(a.caller);
    expect(pairs.map((p) => p.module.id)).toEqual(
      before.map((p) => p.module.id),
    );
    for (const { module, record } of pairs) {
      expect(record).toMatchObject({ id: module.id, ownerId: a.id });
    }
    const ingest = pairs.find((p) => p.module.id === INGEST);
    expect(ingest?.module).toMatchObject({
      templates: ['Task'],
      scheduled: false,
      credentialKeys: ['ingestToken'],
      defaultsConfig: { minConfidence: 0.6 },
    });
    expect(ingest?.record.config.ingestToken).toEqual(expect.any(String));
    expect(await slipsGet(a.caller, { id: INGEST })).toEqual(ingest);
    await expect(
      slipsGet(a.caller, { id: 'no-such-module' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('credential values', () => {
  it('reach a signed-in user only; a read-granted token or a script gets the record without them', async () => {
    const a = await registered();
    const token = (await getPlugin(a.id, INGEST))?.config.ingestToken;
    expect(token).toEqual(expect.any(String));
    const own = await slipsGet(a.caller, { id: INGEST });
    expect(own.record.config.ingestToken).toBe(token);

    const others = {
      'read token': tokenCaller(a.id, `${INGEST}:ingestToken`, ['read']),
      script: systemCaller(a.id, 'cli:test'),
    };
    for (const [label, caller] of Object.entries(others)) {
      const got = await slipsGet(caller, { id: INGEST });
      expect(got.module.credentialKeys, label).toEqual(['ingestToken']);
      expect(got.record.config, label).not.toHaveProperty('ingestToken');
      const { ingestToken: _, ...rest } = own.record.config;
      expect(got.record.config, label).toEqual(rest);

      const listed = await slipsList(caller);
      const ingest = listed.find((p) => p.module.id === INGEST);
      expect(ingest?.record.config, label).not.toHaveProperty('ingestToken');
      expect(JSON.stringify(listed), label).not.toContain(token);
    }

    // The write ops answer the record too: a script's toggle and save see
    // no token, and a config sent back without it keeps it.
    const script = others.script;
    const toggled = await slipsSetEnabled(script, {
      id: INGEST,
      enabled: true,
    });
    expect(toggled.record.config).not.toHaveProperty('ingestToken');
    const saved = await slipsSaveConfig(script, {
      id: INGEST,
      config: toggled.record.config,
    });
    expect(saved.record.config).not.toHaveProperty('ingestToken');
    expect((await getPlugin(a.id, INGEST))?.config.ingestToken).toBe(token);
  });
});

describe('slips.saveConfig', () => {
  it('a non-number for a number default raises invalid and saves nothing', async () => {
    const a = await registered();
    const before = await stored(a.id, INGEST);

    await expect(
      slipsSaveConfig(a.caller, {
        id: INGEST,
        // geminiModel alone would be valid; the bad number blocks it too
        config: { geminiModel: 'other-model', minConfidence: 'lots' },
      }),
    ).rejects.toMatchObject({
      name: 'OpError',
      code: 'invalid',
      message: 'minConfidence must be a number (not saved)',
    });
    expect(await stored(a.id, INGEST)).toEqual(before);
  });

  it('saving message-ingest config without ingestToken keeps the token', async () => {
    const a = await registered();
    const token = (await getPlugin(a.id, INGEST))?.config.ingestToken;
    expect(token).toEqual(expect.any(String));

    const { record } = await slipsSaveConfig(a.caller, {
      id: INGEST,
      config: { minConfidence: '0.8' },
    });
    expect(record.config).toMatchObject({
      minConfidence: 0.8,
      ingestToken: token,
    });
    const after = await stored(a.id, INGEST);
    expect(after.config.ingestToken).toBe(token);
    expect(after.truth.config).toEqual(after.config);
    // /ingest still resolves the owner by it (kv mirror, Postgres on a miss).
    const sender = await callerForCredential(INGEST, 'ingestToken', token, [
      'messages.deliver',
    ]);
    expect(sender?.ownerId).toBe(a.id);

    // A blank token is refused rather than saved (registration would
    // re-mint it and break the sender).
    await expect(
      slipsSaveConfig(a.caller, { id: INGEST, config: { ingestToken: ' ' } }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'ingestToken must not be blank (not saved)',
    });
    expect((await stored(a.id, INGEST)).config.ingestToken).toBe(token);
  });

  it('saves only an ingestToken /ingest would look up', async () => {
    const a = await registered();
    const minted = (await getPlugin(a.id, INGEST))?.config.ingestToken;
    expect(minted).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isCredentialShape(minted)).toBe(true);

    for (const bad of ['two words', 'x'.repeat(129), 'café-token']) {
      await expect(
        slipsSaveConfig(a.caller, { id: INGEST, config: { ingestToken: bad } }),
        bad,
      ).rejects.toMatchObject({
        code: 'invalid',
        message:
          'ingestToken must be 1 to 128 visible ASCII characters, with no spaces (not saved)',
      });
    }
    expect((await stored(a.id, INGEST)).config.ingestToken).toBe(minted);

    // A typed token of any visible ASCII still saves and resolves.
    const typed = `my.Token!${randomUUID()}`;
    await slipsSaveConfig(a.caller, {
      id: INGEST,
      config: { ingestToken: ` ${typed} ` },
    });
    expect((await stored(a.id, INGEST)).config.ingestToken).toBe(typed);
    const sender = await callerForCredential(INGEST, 'ingestToken', typed, [
      'messages.deliver',
    ]);
    expect(sender?.ownerId).toBe(a.id);
  });
});

describe('slips.printTest', () => {
  it("queues one job of the slip's primary template with its stored data", async () => {
    const a = await registered();

    expect(await slipsPrintTest(a.caller, { slug: INGEST })).toEqual({
      queued: expect.any(String),
    });
    const jobs = await jobsList(a.caller);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'Task (test)',
      source: 'test',
      status: 'queued',
      kind: 'template',
    });

    // A template a module prints with is not a slip of its own; a slug
    // that names nothing is not found either.
    for (const slug of ['Task', 'No Such Template']) {
      await expect(slipsPrintTest(a.caller, { slug })).rejects.toMatchObject({
        code: 'not_found',
        message: 'slip not found',
      });
    }
    expect(await jobsList(a.caller)).toHaveLength(1);
  });

  it('a standalone template prints itself; a module slip without its template says so', async () => {
    const a = account(); // never registered: no plugin templates seeded
    await templatesSave(a.caller, {
      name: 'Note',
      template: '<div>{{ title }}</div>',
      data: { title: 'hello' },
    });
    await slipsPrintTest(a.caller, { slug: 'Note' });
    expect(await jobsList(a.caller)).toMatchObject([
      { name: 'Note (test)', source: 'test' },
    ]);

    await expect(
      slipsPrintTest(a.caller, { slug: INGEST }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'template "Task" is missing',
    });
  });
});
