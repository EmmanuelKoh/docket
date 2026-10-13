// tests/artifacts/blob.test.ts — the hosted artifact store
// (lib/artifacts/blob.js) against the in-process Blob fake. The fake's
// store id is mixed case, as a real token's can be: the URL a key derives
// must still equal the (lowercase-host) URL Blob issues.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_DRIVER, getArtifacts } from '@/lib/artifacts/index.js';
import {
  BLOB_HOST,
  BLOB_STORE_ID,
  BLOB_TOKEN,
  blobs,
  calls,
  put as fakePut,
  fetchStub,
} from '../helpers/fake-hosted';

// Hosted env before config.js loads, and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('../helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/artifacts-blob`,
  });
});

vi.mock('@upstash/redis', () => import('../helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('../helpers/fake-hosted'));

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const reads = () =>
  calls.filter((c) => c.meter === 'blob-read').map((c) => c.key);

describe('blob artifact store', () => {
  it('is the driver for STORE_DRIVER=redis, not inline', async () => {
    const store = await getArtifacts();
    expect(BLOB_STORE_ID).not.toBe(BLOB_STORE_ID.toLowerCase());
    expect(ARTIFACT_DRIVER).toBe('blob');
    expect(store.driver).toBe('blob');
    expect(store.inline).toBe(false);
  });

  it('put returns the suffixed key and the URL, and url(key) equals it', async () => {
    const store = await getArtifacts();
    const logged = vi.spyOn(console, 'error');
    try {
      const body = Buffer.from([1, 2, 3]);
      const res = await store.put(
        'jobs/owner-a/job-1.bin',
        body,
        'application/octet-stream',
      );
      expect(res.key).toMatch(/^jobs\/owner-a\/job-1-r\d+\.bin$/);
      expect(res.url).toBe(`https://${BLOB_HOST}/${res.key}`);
      expect(store.url(res.key)).toBe(res.url);
      expect(logged).not.toHaveBeenCalled();

      const before = reads().length;
      expect(await store.get(res.key)).toEqual(body);
      expect(reads().slice(before)).toEqual([res.key]);
    } finally {
      logged.mockRestore();
    }
  });

  it('get of a key with no object is null', async () => {
    const store = await getArtifacts();
    expect(await store.get('jobs/owner-a/never-written.bin')).toBeNull();
  });

  it('a legacy URL passes through url, get and del', async () => {
    const store = await getArtifacts();
    // A row from before keys stored only the URL the old helper returned.
    const { url, pathname } = await fakePut(
      'jobs/owner-b/job-7.png',
      new Uint8Array([9]),
      { addRandomSuffix: true },
    );
    expect(store.url(url)).toBe(url);
    expect(await store.get(url)).toEqual(Buffer.from([9]));

    await store.del([url]);
    expect(blobs.has(pathname)).toBe(false);
    expect(await store.get(url)).toBeNull();
  });

  it('del takes keys and URLs together and never throws', async () => {
    const store = await getArtifacts();
    const a = await store.put(
      'jobs/owner-c/job-1.png',
      Buffer.from('a'),
      'image/png',
    );
    const b = await fakePut('jobs/owner-c/job-0.png', 'b', {
      addRandomSuffix: true,
    });
    await store.del([a.key, b.url, a.url]); // a twice: one delete
    expect(blobs.has(a.key)).toBe(false);
    expect(blobs.has(b.pathname)).toBe(false);
    const dels = calls.filter((c) => c.op === 'del').map((c) => c.key);
    expect(dels.filter((k) => k === a.key)).toHaveLength(1);
    await expect(store.del([])).resolves.toBeUndefined();
  });

  it("keyFromUrl accepts this store's URL and refuses a foreign host", async () => {
    const store = await getArtifacts();
    const key = 'tape/owner-d/take-1-r1.wav';
    expect(store.keyFromUrl(`https://${BLOB_HOST}/${key}`)).toBe(key);
    // Hosts compare case-insensitively.
    expect(
      store.keyFromUrl(
        `https://${BLOB_STORE_ID}.public.blob.vercel-storage.com/${key}`,
      ),
    ).toBe(key);
    expect(
      store.keyFromUrl(
        `https://otherstore.public.blob.vercel-storage.com/${key}`,
      ),
    ).toBeNull();
    expect(store.keyFromUrl(`https://evil.test/${key}`)).toBeNull();
    expect(store.keyFromUrl('not a url')).toBeNull();
  });

  it('keyFromUrl decodes the path and refuses empty, . and .. segments', async () => {
    const store = await getArtifacts();
    const at = (p: string) => store.keyFromUrl(`https://${BLOB_HOST}/${p}`);
    expect(at('tape/owner-d/a%20b-r1.wav')).toBe('tape/owner-d/a b-r1.wav');
    // An encoded slash survives URL parsing and decodes into a segment.
    expect(at('tape/A/idA%2F..%2F..%2FB%2FidB-x.wav')).toBeNull();
    expect(at('tape/A/idA%2F.%2Fx.wav')).toBeNull();
    expect(at('tape/A%2F%2Fx.wav')).toBeNull();
    expect(at('tape/A/%E0%A4%A.wav')).toBeNull(); // malformed escape
    expect(at('')).toBeNull();
  });

  it('put logs loudly when the token-derived URL differs from the issued one', async () => {
    const store = await getArtifacts();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A token naming a different store than the one that answers.
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_OtherStore_secret';
    try {
      await store.put('jobs/owner-e/job-1.png', Buffer.from('p'), 'image/png');
      expect(logged).toHaveBeenCalledOnce();
      expect(String(logged.mock.calls[0][0])).toContain(
        '[artifacts] url(key) mismatch',
      );
    } finally {
      process.env.BLOB_READ_WRITE_TOKEN = BLOB_TOKEN;
      logged.mockRestore();
    }
  });
});
