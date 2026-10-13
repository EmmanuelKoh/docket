// tests/job-artifacts.test.ts — hosted job artifacts by key
// (lib/job-store.js on lib/artifacts/blob.js). New rows record keys and
// still fill *_url (a rollback reads those); readers take the key, then
// the URL, so rows from before keys keep printing, and so do rows whose key
// read fails (a wrong token-derived host) while the URL still answers.
// Listed rows carry the PNG's public URL for the dashboard to load.

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { job } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import {
  createJob,
  createRawJob,
  getJob,
  getJobPng,
  listJobs,
  nextJob,
} from '@/lib/job-store.js';
import { getQueue } from '@/lib/queue/index.js';
import {
  BLOB_HOST,
  BLOB_TOKEN,
  blobs,
  calls,
  put as fakePut,
  fetchStub,
} from './helpers/fake-hosted';

// Hosted env before config.js loads; JOB_CAP 1 so one new job trims every
// finished one. PRINT_WIDTH and FONT_DIR at their defaults, as
// tests/golden-escpos.test.ts does, so a developer's .env cannot change
// what renders.
await vi.hoisted(async () => {
  const { HOSTED_ENV } = await import('./helpers/fake-hosted');
  Object.assign(process.env, HOSTED_ENV, {
    DATA_DIR: `${process.env.DATA_DIR}/job-artifacts`,
    JOB_CAP: '1',
    PRINT_WIDTH: '',
    FONT_DIR: '',
  });
});

vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('./helpers/fake-hosted'));

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const owner = () => `owner-${randomUUID()}`;
const urlOf = (key: string) => `https://${BLOB_HOST}/${key}`;
const artifactReads = (from: number) =>
  calls
    .slice(from)
    .filter((c) => c.meter === 'blob-read' && c.op === 'artifact')
    .map((c) => c.key);

async function rowOf(ownerId: string, id: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)));
  return rows[0];
}

// A blob as the code before keys wrote it: suffixed, and only the URL kept.
async function legacyBlob(pathname: string, body: Uint8Array) {
  return fakePut(pathname, body, { addRandomSuffix: true });
}

async function insertRow(values: Partial<typeof job.$inferInsert>) {
  const db = await getDb();
  await db.insert(job).values({
    ownerId: 'unset',
    id: 'unset',
    status: 'queued',
    width: 576,
    height: 1,
    ...values,
  });
}

const BYTES = Buffer.from([0x1b, 0x40, 0x0a]);

describe('job artifacts by key', () => {
  it('a new row has png_key and bytes_key, with bytes_url the put url', async () => {
    const o = owner();
    const { id } = await createRawJob(o, {
      name: 'raw',
      source: 'test',
      bytes: BYTES,
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    });
    const row = await rowOf(o, id);
    expect(row.pngKey).toMatch(new RegExp(`^jobs/${o}/${id}-r\\d+\\.png$`));
    expect(row.bytesKey).toMatch(new RegExp(`^jobs/${o}/${id}-r\\d+\\.bin$`));
    expect(row.bytesUrl).toBe(urlOf(row.bytesKey as string));
    expect(row.pngUrl).toBe(urlOf(row.pngKey as string));
    expect(row.bytes).toBeNull();
    expect(row.png).toBeNull();

    // The claim reads the bytes once, by key.
    const from = calls.length;
    const served = await nextJob(o);
    expect(served?.bytes).toEqual(BYTES);
    expect(artifactReads(from)).toEqual([row.bytesKey]);
    expect(await getJobPng(o, id)).toEqual(Buffer.from('png'));
  });

  it('an offloaded input is stored by key and re-inflated by getJob', async () => {
    const o = owner();
    const data = { pad: 'x'.repeat(40 * 1024) };
    const { id } = await createJob(o, {
      template: '<div style="display:flex">hi</div>',
      data,
      name: 'big input',
      source: 'test',
    });
    const row = await rowOf(o, id);
    expect(row.data).toBeNull();
    expect(row.dataKey).toMatch(
      new RegExp(`^jobs/${o}/${id}\\.data-r\\d+\\.json$`),
    );
    expect(row.dataUrl).toBe(urlOf(row.dataKey as string));
    expect((await getJob(o, id))?.data).toEqual(data);
  });

  it('a legacy row with only bytes_url still serves nextJob', async () => {
    const o = owner();
    const bin = await legacyBlob(`jobs/${o}/job-1.bin`, BYTES);
    await insertRow({ ownerId: o, id: 'job-1', bytesUrl: bin.url });
    await (await getQueue()).enqueue(o, 'job-1');

    const from = calls.length;
    expect(await nextJob(o)).toEqual({ id: 'job-1', bytes: BYTES });
    expect(artifactReads(from)).toEqual([bin.pathname]);
  });

  it('a row whose key 404s but whose URL resolves still serves nextJob', async () => {
    const o = owner();
    const bin = await legacyBlob(`jobs/${o}/job-1.bin`, BYTES);
    const gone = `jobs/${o}/job-1-gone.bin`;
    await insertRow({
      ownerId: o,
      id: 'job-1',
      bytesKey: gone,
      bytesUrl: bin.url,
    });
    await (await getQueue()).enqueue(o, 'job-1');

    const from = calls.length;
    expect(await nextJob(o)).toEqual({ id: 'job-1', bytes: BYTES });
    expect(artifactReads(from)).toEqual([gone, bin.pathname]);
  });

  it('a key read that fails (not a 404) falls back to the URL', async () => {
    const o = owner();
    const { id } = await createRawJob(o, {
      name: 'raw',
      source: 'test',
      bytes: BYTES,
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    });
    const row = await rowOf(o, id);
    const network = () =>
      calls.filter((c) => c.meter === 'network').map((c) => c.key);
    // A token naming another store: url(key) now derives a host the fake
    // refuses by throwing, as a DNS failure or a 403 would make get throw.
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_OtherStore_secret';
    try {
      const refused = network().length;
      const from = calls.length;
      expect(await nextJob(o)).toEqual({ id, bytes: BYTES });
      expect(await getJobPng(o, id)).toEqual(Buffer.from('png'));
      expect(network().length - refused).toBe(2); // each key read failed...
      expect(artifactReads(from)).toEqual([row.bytesKey, row.pngKey]); // ...and the URLs answered

      // With no URL to fall back to, the key's failure is the answer.
      const db = await getDb();
      await db
        .update(job)
        .set({ pngUrl: null })
        .where(and(eq(job.ownerId, o), eq(job.id, id)));
      await expect(getJobPng(o, id)).rejects.toThrow(
        'test blocked a network fetch',
      );
    } finally {
      process.env.BLOB_READ_WRITE_TOKEN = BLOB_TOKEN;
    }
  });

  it('trim deletes the artifacts of keyed and legacy rows', async () => {
    const o = owner();
    const t = Date.now();
    const legacyPng = await legacyBlob(
      `jobs/${o}/old-1.png`,
      new Uint8Array([1]),
    );
    const legacyBin = await legacyBlob(`jobs/${o}/old-1.bin`, BYTES);
    const legacyData = await legacyBlob(
      `jobs/${o}/old-1.data.json`,
      new Uint8Array([2]),
    );
    await insertRow({
      ownerId: o,
      id: 'old-1',
      status: 'done',
      createdAt: new Date(t - 3 * 3600_000),
      pngUrl: legacyPng.url,
      bytesUrl: legacyBin.url,
      dataUrl: legacyData.url,
    });
    const keyedPng = await fakePut(`jobs/${o}/old-2.png`, new Uint8Array([3]), {
      addRandomSuffix: true,
    });
    const keyedBin = await fakePut(`jobs/${o}/old-2.bin`, BYTES, {
      addRandomSuffix: true,
    });
    // Keys only, as rows will be once a later migration retires *_url.
    await insertRow({
      ownerId: o,
      id: 'old-2',
      status: 'failed',
      createdAt: new Date(t - 2 * 3600_000),
      pngKey: keyedPng.pathname,
      bytesKey: keyedBin.pathname,
    });

    const from = calls.length;
    const { id } = await createRawJob(o, {
      name: 'new',
      source: 'test',
      bytes: BYTES,
      png: Buffer.from('png'),
      width: 576,
      height: 1,
    });

    const deleted = [
      legacyPng.pathname,
      legacyBin.pathname,
      legacyData.pathname,
      keyedPng.pathname,
      keyedBin.pathname,
    ];
    const dels = calls
      .slice(from)
      .filter((c) => c.op === 'del')
      .map((c) => c.key);
    expect(dels.sort()).toEqual([...deleted].sort());
    for (const k of deleted) expect(blobs.has(k), k).toBe(false);
    expect(await rowOf(o, 'old-1')).toBeUndefined();
    expect(await rowOf(o, 'old-2')).toBeUndefined();
    expect((await rowOf(o, id)).bytesKey).toBeTruthy();
  });

  it("listJobs gives each row its PNG's public URL: the one Blob issued, else the key's", async () => {
    const o = owner();
    const png = new Uint8Array([7, 7]);
    const { id } = await createRawJob(o, {
      name: 'new',
      source: 'test',
      bytes: BYTES,
      png: Buffer.from(png),
      width: 576,
      height: 1,
    });
    const issued = (await rowOf(o, id)).pngUrl as string;
    // Keys only, as rows will be once a later migration retires *_url.
    const keyed = await fakePut(`jobs/${o}/job-k.png`, png, {
      addRandomSuffix: true,
    });
    await insertRow({ ownerId: o, id: 'job-k', pngKey: keyed.pathname });
    const legacy = await legacyBlob(`jobs/${o}/job-l.png`, png);
    await insertRow({ ownerId: o, id: 'job-l', pngUrl: legacy.url });
    // Inline, as a local run writes into a shared database: no URL.
    await insertRow({
      ownerId: o,
      id: 'job-i',
      png: Buffer.from(png).toString('base64'),
    });

    const from = calls.length;
    const urls = Object.fromEntries(
      (await listJobs(o)).map((j) => [j.id, j.imageUrl]),
    );
    expect(urls).toEqual({
      [id]: issued,
      'job-k': urlOf(keyed.pathname),
      'job-l': legacy.url,
      'job-i': null,
    });
    // Listing reads no artifact; each URL serves the PNG itself.
    expect(artifactReads(from)).toEqual([]);
    for (const u of [issued, urls['job-k'], legacy.url]) {
      const res = await fetchStub(u as string);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    }

    // With a token naming another store, the key's derived URL is wrong,
    // but the URL Blob issued still is, and comes first.
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_OtherStore_secret';
    try {
      const listed = await listJobs(o);
      expect(listed.find((j) => j.id === id)?.imageUrl).toBe(issued);
    } finally {
      process.env.BLOB_READ_WRITE_TOKEN = BLOB_TOKEN;
    }
  });
});
