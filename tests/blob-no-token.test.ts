// tests/blob-no-token.test.ts — @vercel/blob is never called without the
// read-write token. The SDK treats an empty token as none and falls back
// to Vercel OIDC, which off Vercel can come from the Vercel CLI login and
// pick another store. So with BLOB_READ_WRITE_TOKEN empty,
// lib/artifacts/blob.js put throws and del does nothing, and
// lib/change-signal.js writes nothing; with it set, every call carries it.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/blob-no-token`;
});

const sdk = vi.hoisted(() => ({
  put: vi.fn(async (pathname: string) => ({
    pathname,
    url: `https://store1.public.blob.vercel-storage.com/${pathname}`,
  })),
  del: vi.fn(async () => {}),
}));
vi.mock('@vercel/blob', () => sdk);

const TOKEN = 'vercel_blob_rw_Store1_secret';

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.put.mockClear();
  sdk.del.mockClear();
});

// What a laptop with the Vercel CLI logged in can look like.
function oidcAround() {
  vi.stubEnv('VERCEL_OIDC_TOKEN', 'header.payload.sig');
  vi.stubEnv('BLOB_STORE_ID', 'OtherStore');
}

describe('with BLOB_READ_WRITE_TOKEN empty', () => {
  it('artifact put throws and del does nothing, without calling the SDK', async () => {
    oidcAround();
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const { blobStore } = await import('@/lib/artifacts/blob.js');
    await expect(
      blobStore.put('jobs/o/j.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow(/not configured/);
    await blobStore.del([
      'https://store1.public.blob.vercel-storage.com/jobs/o/j.png',
    ]);
    expect(sdk.put).not.toHaveBeenCalled();
    expect(sdk.del).not.toHaveBeenCalled();
  });

  it('change signals write nothing', async () => {
    oidcAround();
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const signal = await import('@/lib/change-signal.js');
    expect(signal.signalsConfigured()).toBe(false);
    await signal.setQueueSignal('o', true, null);
    await signal.setTickSignal('o', 1234);
    expect(sdk.put).not.toHaveBeenCalled();
  });
});

describe('with BLOB_READ_WRITE_TOKEN set', () => {
  it('every SDK call passes that token', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
    const { blobStore } = await import('@/lib/artifacts/blob.js');
    const signal = await import('@/lib/change-signal.js');
    await blobStore.put('jobs/o/j.png', Buffer.from('x'), 'image/png');
    await blobStore.del(['jobs/o/j.png']);
    await signal.setQueueSignal('o2', true, null);
    const options = [
      ...sdk.put.mock.calls.map((c) => (c as unknown[])[2]),
      ...sdk.del.mock.calls.map((c) => (c as unknown[])[1]),
    ];
    expect(options).toHaveLength(3);
    for (const o of options) expect(o).toMatchObject({ token: TOKEN });
  });
});
