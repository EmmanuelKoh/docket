// tests/tape-store.test.ts — saved takes on the artifact store
// (lib/tape-store.js). Local: payloads are files keyed under
// tape/{owner}/, and a take from before keys (data/tape/{id}.json and
// .wav) still loads and moves under its owner on the next update. Hosted:
// a client-uploaded WAV is attached by key, only from this store and only
// among this take's own keys (compared by path segment, after decoding),
// and a document whose key read fails still loads from its legacy URL.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DATA_DIR } from '@/config.js';
import { tapeTake } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import * as localTapeStore from '@/lib/tape-store.js';
import {
  BLOB_HOST,
  BLOB_TOKEN,
  blobs,
  put as fakePut,
  fetchStub,
  HOSTED_ENV,
} from './helpers/fake-hosted';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/tape-store`;
});

// Inert until the hosted block reloads the modules with HOSTED_ENV.
vi.mock('@upstash/redis', () => import('./helpers/fake-hosted'));
vi.mock('@vercel/blob', () => import('./helpers/fake-hosted'));

const noNetwork = () => {
  throw new Error('network access is disabled in tests');
};

beforeAll(() => {
  vi.stubGlobal('fetch', noNetwork);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const owner = () => `owner-${randomUUID()}`;
const PAYLOAD = { settings: { a: 1 }, doc: { notes: [1, 2] } };
const META = { name: 'Take', seconds: 1, sampleRate: 22050, noteCount: 2 };

async function rowOf(id: string) {
  const db = await getDb();
  return (await db.select().from(tapeTake).where(eq(tapeTake.id, id)))[0];
}

describe('local takes', () => {
  const store = localTapeStore;
  const file = (...p: string[]) => path.join(DATA_DIR, 'tape', ...p);

  it('answers direct uploads and keeps payloads under tape/{owner}/', async () => {
    const o = owner();
    expect(store.audioUploadMode()).toBe('direct');
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    expect(take).not.toHaveProperty('docUrl');
    expect(take).not.toHaveProperty('audioUrl');
    expect(fs.existsSync(file(o, `${take.id}.json`))).toBe(true);

    const wav = Buffer.from('RIFF-local');
    expect((await store.saveTakeAudio(o, take.id, wav)).hasAudio).toBe(true);
    expect(await store.getTakeAudio(o, take.id)).toEqual({ buffer: wav });
    expect(await rowOf(take.id)).toMatchObject({
      docKey: `tape/${o}/${take.id}.json`,
      docUrl: null,
      audioKey: `tape/${o}/${take.id}.wav`,
      audioUrl: null,
    });
  });

  it('a take from before keys loads, and an update moves it under tape/{owner}/', async () => {
    const o = owner();
    const id = randomUUID();
    const wav = Buffer.from('RIFF-legacy');
    fs.mkdirSync(file(), { recursive: true });
    fs.writeFileSync(file(`${id}.json`), JSON.stringify(PAYLOAD));
    fs.writeFileSync(file(`${id}.wav`), wav);
    const db = await getDb();
    await db
      .insert(tapeTake)
      .values({ id, ownerId: o, ...META, hasAudio: true });

    expect(await store.getTakePayload(o, id)).toEqual(PAYLOAD);
    expect(await store.getTakeAudio(o, id)).toEqual({ buffer: wav });

    const next = { settings: { a: 2 }, doc: { notes: [3] } };
    await store.updateTake(o, id, {
      name: 'Moved',
      noteCount: 1,
      payload: next,
    });

    expect(fs.existsSync(file(`${id}.json`))).toBe(false);
    expect(fs.existsSync(file(`${id}.wav`))).toBe(false);
    expect(JSON.parse(fs.readFileSync(file(o, `${id}.json`), 'utf8'))).toEqual(
      next,
    );
    expect(fs.readFileSync(file(o, `${id}.wav`))).toEqual(wav);
    expect(await rowOf(id)).toMatchObject({
      name: 'Moved',
      docKey: `tape/${o}/${id}.json`,
      audioKey: `tape/${o}/${id}.wav`,
    });
    expect(await store.getTakePayload(o, id)).toEqual(next);
    expect(await store.getTakeAudio(o, id)).toEqual({ buffer: wav });

    // A second update rewrites the same key and keeps it.
    await store.updateTake(o, id, { payload: PAYLOAD });
    expect(await store.getTakePayload(o, id)).toEqual(PAYLOAD);
  });

  it('refuses a client-upload attach', async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    await expect(
      store.attachTakeAudio(
        o,
        take.id,
        `https://${BLOB_HOST}/tape/${o}/${take.id}.wav`,
      ),
    ).rejects.toThrow("audio upload isn't available here");
  });
});

describe('hosted takes', () => {
  let store: typeof localTapeStore;

  beforeAll(async () => {
    for (const [k, v] of Object.entries(HOSTED_ENV)) vi.stubEnv(k, v);
    vi.stubGlobal('fetch', fetchStub);
    vi.resetModules();
    store = await import('@/lib/tape-store.js');
  });

  afterAll(() => {
    vi.stubGlobal('fetch', noNetwork);
  });

  // What the browser's client upload does: a suffixed pathname under the
  // prefix the upload route allows.
  const upload = (pathname: string) =>
    fakePut(pathname, new Uint8Array([0x52, 0x49]), { addRandomSuffix: true });

  it('answers client uploads; the document round-trips by key', async () => {
    const o = owner();
    expect(store.audioUploadMode()).toBe('client');
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    const row = await rowOf(take.id);
    expect(row.docKey).toMatch(
      new RegExp(`^tape/${o}/${take.id}-r\\d+\\.json$`),
    );
    expect(row.docUrl).toBe(`https://${BLOB_HOST}/${row.docKey}`);
    expect(await store.getTakePayload(o, take.id)).toEqual(PAYLOAD);

    // An update writes a new suffixed key and deletes the old object.
    await store.updateTake(o, take.id, { payload: { doc: { notes: [] } } });
    expect(blobs.has(row.docKey as string)).toBe(false);
    expect(await store.getTakePayload(o, take.id)).toEqual({
      doc: { notes: [] },
    });
  });

  it('attachTakeAudio writes both audioKey and audioUrl', async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    const wav = await upload(`tape/${o}/${take.id}.wav`);

    const meta = await store.attachTakeAudio(o, take.id, wav.url);
    expect(meta.hasAudio).toBe(true);
    expect(meta).not.toHaveProperty('audioUrl');
    expect(await rowOf(take.id)).toMatchObject({
      audioKey: wav.pathname,
      audioUrl: wav.url,
      hasAudio: true,
    });
    expect(await store.getTakeAudio(o, take.id)).toEqual({ url: wav.url });
  });

  it("attaches a .wav under the take's own directory", async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    const wav = await upload(`tape/${o}/${take.id}/take.wav`);

    expect((await store.attachTakeAudio(o, take.id, wav.url)).hasAudio).toBe(
      true,
    );
    expect(await rowOf(take.id)).toMatchObject({ audioKey: wav.pathname });
  });

  it("refuses another owner's prefix and another store's host", async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    const theirs = await upload(`tape/${owner()}/${take.id}.wav`);
    const otherTake = await upload(`tape/${o}/${randomUUID()}.wav`);
    const foreign = `https://otherstore.public.blob.vercel-storage.com/tape/${o}/${take.id}-r1.wav`;

    for (const url of [theirs.url, otherTake.url, foreign, 'not a url']) {
      await expect(store.attachTakeAudio(o, take.id, url), url).rejects.toThrow(
        'audio upload failed',
      );
    }
    expect(await rowOf(take.id)).toMatchObject({
      audioKey: null,
      audioUrl: null,
      hasAudio: false,
    });
  });

  it("refuses a path that only looks like this take's: an encoded traversal or a sibling id", async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    const victim = owner();
    const theirs = await upload(`tape/${victim}/${randomUUID()}.wav`);
    // %2F decodes to '/', so the key is tape/{o}/{id}/../../{victim}/...:
    // a bare startsWith accepted it, and url(key) resolved to the victim's
    // WAV (which the next attach would then delete).
    const traversal = `https://${BLOB_HOST}/tape/${o}/${take.id}%2F..%2F..%2F${theirs.pathname.split('/').slice(1).join('%2F')}`;
    // A take whose id extends this one's: same string prefix, other take.
    const sibling = await upload(`tape/${o}/${take.id}B.wav`);
    // This take's document, not a recording, and a non-WAV object under
    // the take's own directory.
    const doc = (await rowOf(take.id)).docUrl as string;
    const notes = await upload(`tape/${o}/${take.id}/notes.json`);

    for (const url of [traversal, sibling.url, doc, notes.url]) {
      await expect(store.attachTakeAudio(o, take.id, url), url).rejects.toThrow(
        'audio upload failed',
      );
    }
    expect(blobs.has(theirs.pathname)).toBe(true);
    expect(await rowOf(take.id)).toMatchObject({
      audioKey: null,
      audioUrl: null,
      hasAudio: false,
    });
  });

  it('a document whose key read fails loads from its URL', async () => {
    const o = owner();
    const take = await store.createTake(o, { ...META, payload: PAYLOAD });
    // A token naming another store: the key now derives a host the fake
    // refuses (it throws, as a DNS failure would), while docUrl still
    // names the store that holds the object.
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_OtherStore_secret');
    try {
      expect(await store.getTakePayload(o, take.id)).toEqual(PAYLOAD);
      // No URL to fall back to: the key's failure is the answer.
      const db = await getDb();
      await db
        .update(tapeTake)
        .set({ docUrl: null })
        .where(eq(tapeTake.id, take.id));
      await expect(store.getTakePayload(o, take.id)).rejects.toThrow(
        'test blocked a network fetch',
      );
    } finally {
      vi.stubEnv('BLOB_READ_WRITE_TOKEN', BLOB_TOKEN);
    }
  });
});
