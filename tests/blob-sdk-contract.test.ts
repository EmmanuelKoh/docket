// tests/blob-sdk-contract.test.ts — every call lib/ and the Tape client
// make to @vercel/blob, checked against the installed package instead of
// the in-memory fake the other tests mock it with:
//   wire   lib/artifacts/blob.js and lib/change-signal.js run the real SDK
//          against a local HTTP server (VERCEL_BLOB_API_URL), which records
//          each request's method, path, headers and body
//   types  the calls each site made (captured at runtime, values included)
//          are type-checked by the TypeScript compiler against the
//          package's own .d.ts files, with the result fields they read
// Call sites: lib/artifacts/blob.js put and del, lib/change-signal.js put,
// components/tape/persist.js upload, and lib/ops/tape.js authorizeUpload
// (what app/api/tape/takes/upload/route.ts returns from
// onBeforeGenerateToken; the typecheck covers that handleUpload call).
//
// A Vercel OIDC token and BLOB_STORE_ID are set on purpose: the SDK
// prefers them over BLOB_READ_WRITE_TOKEN unless a call passes its token.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { del as blobDel, put as blobPut } from '@vercel/blob';
import { upload as clientUpload } from '@vercel/blob/client';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BLOB_HOST, BLOB_STORE_ID, BLOB_TOKEN } from './helpers/fake-hosted';

// Hosted env before config.js loads (tape.authorizeUpload checks the
// driver), and this file's own DATA_DIR.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('./helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/blob-sdk-contract`,
  });
});

vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
// The real SDK, with its entry points recorded.
vi.mock('@vercel/blob', async (importOriginal) => {
  const real = await importOriginal<typeof import('@vercel/blob')>();
  return { ...real, put: vi.fn(real.put), del: vi.fn(real.del) };
});
// upload() would POST to the page's own origin; record it and answer.
vi.mock('@vercel/blob/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@vercel/blob/client')>();
  return {
    ...real,
    upload: vi.fn(async (pathname: string) => ({
      url: `https://${BLOB_HOST}/${pathname.replace('.wav', '-Rand0m.wav')}`,
    })),
  };
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OWNER = 'owner-1';

// An unexpired JWT shape, so the SDK's OIDC path never tries a refresh.
const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const OIDC_TOKEN = `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

type Recorded = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};
const requests: Recorded[] = [];
const last = () => requests[requests.length - 1];

// Answers like the Blob API: put returns the stored pathname (suffixed
// when asked) and its public URL; delete returns an empty object.
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rec = {
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    };
    requests.push(rec);
    let answer = {};
    if (rec.method === 'PUT') {
      const asked = new URL(rec.path, 'http://x').searchParams.get('pathname');
      const stored =
        rec.headers['x-add-random-suffix'] === '1'
          ? String(asked).replace(/(\.[^./]*)?$/, '-Rand0m$1')
          : String(asked);
      const url = `https://${BLOB_HOST}/${stored}`;
      answer = {
        url,
        downloadUrl: `${url}?download=1`,
        pathname: stored,
        contentType: rec.headers['x-content-type'],
        contentDisposition: 'inline',
        etag: '"1"',
      };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer));
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv('VERCEL_BLOB_API_URL', `http://127.0.0.1:${port}/api/blob`);
  vi.stubEnv('VERCEL_OIDC_TOKEN', OIDC_TOKEN);
  vi.stubEnv('BLOB_STORE_ID', 'OidcOnlyStore');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await new Promise((resolve) => server.close(resolve));
});

// Every request authenticates with the read-write token's store.
const AUTH = {
  authorization: `Bearer ${BLOB_TOKEN}`,
  'x-vercel-blob-store-id': BLOB_STORE_ID,
};

describe('lib/artifacts/blob.js on the real SDK', () => {
  it('put sends a public, suffixed upload and keeps the returned key', async () => {
    const errors = vi.spyOn(console, 'error');
    const { blobStore } = await import('@/lib/artifacts/blob.js');
    const res = await blobStore.put(
      `jobs/${OWNER}/job-1.png`,
      Buffer.from('png'),
      'image/png',
    );
    const key = `jobs/${OWNER}/job-1-Rand0m.png`;
    expect(res).toEqual({ key, url: `https://${BLOB_HOST}/${key}` });
    // url(key) matched the URL Blob issued.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();

    const r = last();
    expect(r.method).toBe('PUT');
    expect(r.path).toBe(`/api/blob/?pathname=jobs%2F${OWNER}%2Fjob-1.png`);
    expect(r.headers).toMatchObject({
      ...AUTH,
      'x-vercel-blob-access': 'public',
      'x-add-random-suffix': '1',
      'x-content-type': 'image/png',
    });
    expect(r.headers).not.toHaveProperty('x-allow-overwrite');
    expect(r.body).toBe('png');
  });

  it('del sends the URLs of the keys', async () => {
    const { blobStore } = await import('@/lib/artifacts/blob.js');
    const key = `jobs/${OWNER}/job-1-Rand0m.png`;
    await blobStore.del([key]);
    const r = last();
    expect(r).toMatchObject({ method: 'POST', path: '/api/blob/delete' });
    expect(r.headers).toMatchObject(AUTH);
    expect(JSON.parse(r.body)).toEqual({
      urls: [`https://${BLOB_HOST}/${key}`],
    });
  });
});

describe('lib/change-signal.js on the real SDK', () => {
  it('flags overwrite in place with the 60s cache floor', async () => {
    const signal = await import('@/lib/change-signal.js');
    await signal.setQueueSignal(OWNER, true, null);
    const queue = last();
    await signal.setTickSignal(OWNER, 1234);
    const tick = last();

    for (const [r, purpose] of [
      [queue, 'queue-flag'],
      [tick, 'tick-flag'],
    ] as const) {
      expect(r.method).toBe('PUT');
      expect(r.path).toBe(`/api/blob/?pathname=${purpose}%2F${OWNER}.json`);
      expect(r.headers).toMatchObject({
        ...AUTH,
        'x-vercel-blob-access': 'public',
        'x-add-random-suffix': '0',
        'x-allow-overwrite': '1',
        'x-cache-control-max-age': '60',
        'x-content-type': 'application/json',
      });
    }
    expect(JSON.parse(queue.body)).toEqual({ hasWork: true });
    expect(JSON.parse(tick.body)).toEqual({ nextDueAt: 1234 });
  });
});

describe('the Tape client upload', () => {
  it('persist.saveTake uploads with the options the route token allows', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? 'GET', body: init.body });
      const take = { id: 'take-1', ownerId: OWNER };
      return Response.json(
        init.method === 'POST' ? { take, audio: 'client' } : { take },
      );
    });
    const { saveTake } = await import('@/components/tape/persist.js');
    const wav = new Blob(['RIFF'], { type: 'audio/wav' });
    await saveTake({
      name: 'Take',
      seconds: 1,
      sampleRate: 22050,
      noteCount: 0,
      settings: {},
      doc: {},
      wav,
    });
    vi.unstubAllGlobals();

    expect(clientUpload).toHaveBeenCalledWith(`tape/${OWNER}/take-1.wav`, wav, {
      access: 'public',
      handleUploadUrl: '/api/tape/takes/upload',
      contentType: 'audio/wav',
    });
    // The URL upload() returned is what the take records.
    expect(sent.at(-1)).toEqual({
      url: '/api/tape/takes/take-1',
      method: 'PATCH',
      body: JSON.stringify({
        audioUrl: `https://${BLOB_HOST}/tape/${OWNER}/take-1-Rand0m.wav`,
      }),
    });
  });
});

// Type errors in a probe file that imports the installed package.
function typeErrors(source: string): string[] {
  const file = path.join(ROOT, 'tests', '__blob_sdk_probe__.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (f) => f === file || fileExists(f);
  host.readFile = (f) => (f === file ? source : readFile(f));
  host.getSourceFile = (f, lang, ...rest) =>
    f === file
      ? ts.createSourceFile(f, source, lang)
      : getSourceFile(f, lang, ...rest);
  const program = ts.createProgram([file], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('the recorded calls against the package types', () => {
  it('type-check with the values each call site passed', async () => {
    const { userCaller } = await import('@/lib/ops/caller.js');
    const { tapeAuthorizeUpload } = await import('@/lib/ops/tape.js');
    const tokenOptions = await tapeAuthorizeUpload(
      userCaller({ userId: OWNER, role: 'user' }),
      { pathname: `tape/${OWNER}/take-1.wav` },
    );

    const lit = (v: unknown) => JSON.stringify(v);
    const body = (b: unknown) => {
      if (Buffer.isBuffer(b)) return 'buffer';
      if (typeof b === 'string') return lit(b);
      if (b instanceof Blob) return 'wav';
      throw new Error(`unexpected body ${typeof b}`);
    };
    const puts = vi
      .mocked(blobPut)
      .mock.calls.map(
        ([p, b, o]) => `await put(${lit(p)}, ${body(b)}, ${lit(o)}),`,
      );
    const uploads = vi
      .mocked(clientUpload)
      .mock.calls.map(
        ([p, b, o]) => `await upload(${lit(p)}, ${body(b)}, ${lit(o)}),`,
      );
    const dels = vi
      .mocked(blobDel)
      .mock.calls.map(([u, o]) => `await del(${lit(u)}, ${lit(o)});`);
    // artifacts put, queue flag, tick flag; one del; one client upload
    expect([puts.length, dels.length, uploads.length]).toEqual([3, 1, 1]);

    const source = `
      import { del, put } from '@vercel/blob';
      import { handleUpload, upload } from '@vercel/blob/client';
      import type { HandleUploadBody, HandleUploadOptions } from '@vercel/blob/client';
      declare const buffer: Buffer;
      declare const wav: Blob;
      type TokenOptions = Awaited<ReturnType<HandleUploadOptions['onBeforeGenerateToken']>>;

      export async function probe() {
        // lib/artifacts/blob.js reads pathname and url; change-signal and
        // persist read url.
        const results: { pathname: string; url: string }[] = [
          ${puts.join('\n')}
          ${uploads.join('\n')}
        ];
        ${dels.join('\n')}
        await handleUpload({
          body: {} as HandleUploadBody,
          request: {} as Request,
          onBeforeGenerateToken: async () => (${lit(tokenOptions)} satisfies TokenOptions),
        });
        return results;
      }

      // Not vacuous: a misspelled option is an error.
      // @ts-expect-error
      put('x', 'x', { access: 'public', cacheControlMaxAg: 60 });
    `;
    expect(typeErrors(source)).toEqual([]);
  });
});
