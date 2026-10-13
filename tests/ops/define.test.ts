// tests/ops/define.test.ts — the operation seam (lib/ops/define.js): who
// may call, input validation, the dev-time output check, spec validation,
// and the strict input JSON Schema exporter (lib/ops/schema.js).

import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import {
  deviceCaller,
  systemCaller,
  tokenCaller,
  userCaller,
} from '@/lib/ops/caller.js';
import { defineOperation, JOB_CREATE, OpError } from '@/lib/ops/define.js';
import { Binary, toJsonSchema } from '@/lib/ops/schema.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-define`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type Permission = 'public' | 'owner' | 'admin';

function testOp(
  name: string,
  permission: Permission | Permission[],
  effects = ['db.read'],
) {
  return defineOperation({
    name,
    description: `test op ${name}`,
    input: z.object({}),
    permission,
    effects,
    run: async () => ({ ok: true }),
  });
}

// Resolves to 'ok' or the OpError code the call was refused with.
async function outcome(op: ReturnType<typeof testOp>, caller: unknown) {
  try {
    await op(caller as Parameters<typeof op>[0], {});
    return 'ok';
  } catch (err) {
    expect(err).toBeInstanceOf(OpError);
    return (err as OpError).code;
  }
}

describe('permissions', () => {
  const owner = `owner-${randomUUID()}`;
  const ops = {
    public: testOp('test.public', 'public'),
    owner: testOp('test.owner', 'owner'),
    admin: testOp('test.admin', 'admin'),
  };
  const callers = {
    user: userCaller({ userId: owner, role: 'user' }),
    'admin user': userCaller({ userId: owner, role: 'admin' }),
    system: systemCaller(owner),
    'system admin': systemCaller(owner, 'cli:test', { admin: true }),
    // scripts/create-user.js's shape: no owner, so no owner ops
    'ownerless system': systemCaller(),
    'ownerless system admin': systemCaller(null, 'cli', { admin: true }),
    device: deviceCaller({
      ownerId: owner,
      deviceId: 'dev-1',
      owners: [owner],
    }),
    token: tokenCaller(owner, 'message-ingest:ingestToken', [
      'test.public',
      'test.owner',
      'test.admin',
    ]),
    null: null,
  };
  // caller -> [public, owner, admin]
  const expected: Record<keyof typeof callers, string[]> = {
    user: ['ok', 'ok', 'forbidden'],
    'admin user': ['ok', 'ok', 'ok'],
    system: ['ok', 'ok', 'forbidden'],
    'system admin': ['ok', 'ok', 'ok'],
    'ownerless system': ['ok', 'forbidden', 'forbidden'],
    'ownerless system admin': ['ok', 'forbidden', 'ok'],
    device: ['forbidden', 'forbidden', 'forbidden'],
    token: ['ok', 'ok', 'forbidden'],
    null: ['ok', 'unauthenticated', 'unauthenticated'],
  };

  for (const [label, caller] of Object.entries(callers)) {
    it(`${label} caller`, async () => {
      const got = [
        await outcome(ops.public, caller),
        await outcome(ops.owner, caller),
        await outcome(ops.admin, caller),
      ];
      expect(got).toEqual(expected[label as keyof typeof callers]);
    });
  }

  it('refuses owner ops to a device even with full grants', async () => {
    const device = { ...callers.device, grants: null };
    expect(await outcome(ops.public, device)).toBe('ok');
    expect(await outcome(ops.owner, device)).toBe('forbidden');
  });

  it('builds callers with the documented shapes', () => {
    expect(callers.user).toEqual({
      ownerId: owner,
      actor: { kind: 'user', id: owner },
      role: 'user',
      grants: null,
    });
    expect(userCaller({ userId: owner, role: 'something' }).role).toBe('user');
    expect(callers.device.grants).toEqual([]);
    expect(callers.system.role).toBeNull();
    expect(callers['system admin'].role).toBe('admin');
  });
});

describe('grants', () => {
  const owner = `owner-${randomUUID()}`;
  const read = testOp('test.read', 'owner', ['db.read', 'artifact.get']);
  const write = testOp('test.write', 'owner', ['db.read', 'db.write']);

  it('admits listed ops and refuses unlisted ones', async () => {
    const caller = tokenCaller(owner, 'm:key', ['test.write']);
    expect(await outcome(write, caller)).toBe('ok');
    expect(await outcome(read, caller)).toBe('forbidden');
  });

  it("'read' admits readOnly ops only", async () => {
    const caller = tokenCaller(owner, 'm:key', ['read']);
    expect(await outcome(read, caller)).toBe('ok');
    expect(await outcome(write, caller)).toBe('forbidden');
  });

  it('a token caller needs grants', () => {
    expect(() =>
      tokenCaller(owner, 'm:key', undefined as unknown as string[]),
    ).toThrow('grants required');
    expect(() => tokenCaller(owner, 'm:key', [])).toThrow('grants required');
  });
});

describe('input', () => {
  const op = defineOperation({
    name: 'test.input',
    description: 'echo the job id',
    input: z.object({
      id: z.string({ error: 'job query parameter is required' }),
    }),
    permission: 'owner',
    effects: ['db.read'],
    run: async (_caller, { id }) => ({ id }),
  });
  const caller = userCaller({ userId: `owner-${randomUUID()}`, role: 'user' });

  it('raises invalid with the first issue message', async () => {
    const err = await op(caller, { id: null as unknown as string }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(OpError);
    expect(err.code).toBe('invalid');
    expect(err.message).toBe('job query parameter is required');
    await expect(op(caller)).rejects.toMatchObject({
      code: 'invalid',
      message: 'job query parameter is required',
    });
  });

  it('passes parsed input to run', async () => {
    expect(await op(caller, { id: 'job-1' })).toEqual({ id: 'job-1' });
  });
});

describe('output check', () => {
  const caller = userCaller({ userId: `owner-${randomUUID()}`, role: 'user' });
  const make = (result: unknown) =>
    defineOperation({
      name: 'test.output',
      description: 'return a fixed result',
      input: z.object({}),
      output: z.object({ id: z.string() }),
      permission: 'owner',
      effects: ['db.read'],
      run: async () => result,
    });

  it('throws on output drift', async () => {
    await expect(make({ id: 7 })(caller)).rejects.toThrow();
  });

  it('throws on a Date in the result', async () => {
    await expect(make({ id: 'a', at: new Date() })(caller)).rejects.toThrow(
      'result.at: Date is not a JSON value',
    );
  });

  it('throws on a Date inside an array', async () => {
    await expect(
      make({ id: 'a', items: [{ at: new Date() }] })(caller),
    ).rejects.toThrow('result.items.0.at: Date is not a JSON value');
  });

  it('returns a valid result unmodified', async () => {
    const result = { id: 'a', extra: [1, { nested: true }] };
    const got = await make(result)(caller);
    expect(got).toBe(result);
    expect(got).toEqual({ id: 'a', extra: [1, { nested: true }] });
  });

  it('allows Buffers (Binary bodies)', async () => {
    const op = defineOperation({
      name: 'test.binary',
      description: 'return bytes',
      input: z.object({}),
      output: Binary,
      permission: 'owner',
      effects: ['artifact.get'],
      run: async () => ({
        contentType: 'image/png',
        body: Buffer.from([1, 2]),
      }),
    });
    expect((await op(caller)).body).toEqual(Buffer.from([1, 2]));
  });

  describe('in production', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('skips the check', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.resetModules();
      const prod = await import('@/lib/ops/define.js');
      const result = { id: 7, at: new Date(0) };
      const op = prod.defineOperation({
        name: 'test.prod',
        description: 'return a drifted result',
        input: z.object({}),
        output: z.object({ id: z.string() }),
        permission: 'owner',
        effects: ['db.read'],
        run: async () => result,
      });
      expect(await op(caller)).toBe(result);
    });
  });
});

describe('spec validation', () => {
  const base = {
    name: 'test.spec',
    description: 'spec checks',
    input: z.object({}),
    permission: 'owner' as const,
    effects: ['db.read'],
    run: async () => null,
  };

  it('accepts a valid spec', () => {
    expect(() => defineOperation(base)).not.toThrow();
  });

  it('throws on an unknown permission', () => {
    expect(() =>
      defineOperation({ ...base, permission: 'device' as 'owner' }),
    ).toThrow('bad spec device');
  });

  it('throws on an unknown effect', () => {
    expect(() =>
      defineOperation({ ...base, effects: ['db.read', 'redis.write'] }),
    ).toThrow('bad spec redis.write');
  });

  it('throws on empty effects', () => {
    expect(() => defineOperation({ ...base, effects: [] })).toThrow('bad spec');
  });

  it('derives readOnly from write effects', () => {
    const readOnly = (effects: string[]) =>
      (defineOperation({ ...base, effects }).spec as { readOnly: boolean })
        .readOnly;
    expect(readOnly(['db.read', 'kv.read', 'render', 'artifact.get'])).toBe(
      true,
    );
    expect(readOnly(['db.read', 'llm'])).toBe(false);
    expect(readOnly(['render', ...JOB_CREATE])).toBe(false);
  });
});

describe('toJsonSchema', () => {
  it('renders Binary bodies as base64 strings', () => {
    const schema = toJsonSchema(z.object({ audio: Binary }));
    expect(schema.properties.audio.properties.body).toEqual({
      type: 'string',
      contentEncoding: 'base64',
    });
  });

  it('throws on z.date()', () => {
    expect(() => toJsonSchema(z.object({ at: z.date() }))).toThrow(
      'date is not JSON',
    );
  });

  it('throws on other instanceof checks', () => {
    expect(() =>
      toJsonSchema(z.object({ raw: z.instanceof(Uint8Array) })),
    ).toThrow('custom is not JSON');
  });
});
