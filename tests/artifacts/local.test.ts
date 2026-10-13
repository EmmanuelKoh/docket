// tests/artifacts/local.test.ts — the local artifact store
// (lib/artifacts/local.js): one file per key under DATA_DIR, and nothing
// outside it.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DATA_DIR } from '@/config.js';
import { ARTIFACT_DRIVER, getArtifacts } from '@/lib/artifacts/index.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/artifacts-local`;
});

const noNetwork = () => {
  throw new Error('network access is disabled in tests');
};

beforeAll(() => {
  vi.stubGlobal('fetch', noNetwork);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;

describe('local artifact store', () => {
  it('is the driver for STORE_DRIVER=json: inline jobs, no URLs', async () => {
    const store = await getArtifacts();
    expect(ARTIFACT_DRIVER).toBe('local');
    expect(store.driver).toBe('local');
    expect(store.inline).toBe(true);
    expect(store.url('tape/x/y.json')).toBeNull();
    expect(
      store.keyFromUrl('https://x.public.blob.vercel-storage.com/y'),
    ).toBeNull();
  });

  it('puts, gets and deletes a file under DATA_DIR by key', async () => {
    const store = await getArtifacts();
    const key = `tape/${owner()}/${randomUUID()}.json`;
    const body = Buffer.from('{"doc":1}');

    expect(await store.put(key, body, 'application/json')).toEqual({
      key,
      url: null,
    });
    expect(fs.readFileSync(path.join(DATA_DIR, key))).toEqual(body);
    expect(await store.get(key)).toEqual(body);

    await store.del([key]);
    expect(fs.existsSync(path.join(DATA_DIR, key))).toBe(false);
    expect(await store.get(key)).toBeNull();
    // Deleting again, or a key that never existed, is quiet.
    await expect(store.del([key, 'tape/none.json'])).resolves.toBeUndefined();
  });

  it('rejects .. and absolute keys', async () => {
    const store = await getArtifacts();
    const outside = path.join(path.dirname(DATA_DIR), 'escaped.txt');
    for (const key of [
      '../escaped.txt',
      'tape/../../escaped.txt',
      outside,
      '/tmp/escaped.txt',
    ]) {
      await expect(
        store.put(key, Buffer.from('x'), 'text/plain'),
        key,
      ).rejects.toThrow(/artifact key rejected/);
      await expect(store.get(key), key).rejects.toThrow(
        /artifact key rejected/,
      );
    }
    expect(fs.existsSync(outside)).toBe(false);

    // del never throws, and never touches a file outside DATA_DIR.
    fs.writeFileSync(outside, 'keep');
    try {
      await expect(
        store.del(['../escaped.txt', outside]),
      ).resolves.toBeUndefined();
      expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it('reads a legacy URL where it lives, and never deletes one', async () => {
    const store = await getArtifacts();
    const legacy =
      'https://somestore.public.blob.vercel-storage.com/tape/a.json';
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      fetched.push(u);
      return u === legacy
        ? new Response('{"doc":1}', { status: 200 })
        : new Response(null, { status: 404 });
    });
    try {
      expect((await store.get(legacy))?.toString()).toBe('{"doc":1}');
      expect(await store.get(`${legacy}.missing`)).toBeNull();
      await store.del([legacy]);
      expect(fetched).toEqual([legacy, `${legacy}.missing`]);
    } finally {
      vi.stubGlobal('fetch', noNetwork);
    }
  });
});
