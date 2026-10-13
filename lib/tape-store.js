// lib/tape-store.js — saved-takes storage for the Tape tool.
// A take = meta (name, duration, note count) + payload (the take document
// and control settings, JSON) + the recording (16-bit mono WAV, lossless
// on purpose: re-transcription must reproduce the saved tape exactly).
//
// Phase 4 split: take META lives in Postgres (the tape_take table, the
// system of record); the heavy payloads are artifacts (lib/artifacts/)
// keyed tape/{owner}/{id}.json and .wav, recorded by key —
//   blob  — Vercel Blob (STORE_DRIVER=redis); audio arrives via the
//           browser's client upload (@vercel/blob/client) because a long
//           WAV exceeds the platform's ~4.5MB request cap
//   local — files under data/tape/{owner}/ (local dev); audio is a PUT
//           to our own route
// Callers never know which is active. All functions are async.
//
// Rows from before keys: hosted ones read their *_url columns (kept
// indefinitely: the WAVs are the irreplaceable copy); local ones read the
// old flat names data/tape/{id}.json and .wav, and move under
// tape/{owner}/ on their next update.
//
// Soft delete: a deleted take is tombstoned (deletedAt) and hidden, its
// payloads untouched — an unrepeatable recording deserves better than one
// confirm dialog between a click and permanent loss. Tombstones older
// than 30 days are purged for real (row + payloads) by purgeTakes, which
// the takes list route calls before listing; listTakes itself only reads.

import crypto from 'crypto';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { tapeTake } from '../db/schema.js';
import { ARTIFACT_DRIVER, getArtifacts, readFirst } from './artifacts/index.js';
import { getDb } from './db.js';

const PURGE_MS = 30 * 24 * 3600 * 1000;

// ids are server-minted UUIDs; anything else never touches storage
const safeId = id => /^[a-z0-9-]{8,64}$/i.test(id);

const toMeta = row => ({
  id: row.id,
  ownerId: row.ownerId,
  name: row.name,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  seconds: row.seconds,
  sampleRate: row.sampleRate,
  noteCount: row.noteCount,
  hasAudio: row.hasAudio,
  ...(row.deletedAt ? { deletedAt: row.deletedAt.toISOString() } : {}),
});

// ---- payloads (lib/artifacts) ----

const docKeyOf = (ownerId, id) => `tape/${ownerId}/${id}.json`;
const audioKeyOf = (ownerId, id) => `tape/${ownerId}/${id}.wav`;

// Where a payload ('doc' or 'audio') lives, best first: the key, then the
// legacy URL; a row with neither is a local take from before keys, at the
// old flat name (audio only when it has some). [0] is the one to delete.
function refsFor(row, f) {
  const refs = [row[`${f}Key`], row[`${f}Url`]].filter(Boolean);
  if (refs.length) return refs;
  if (f === 'audio' && !row.hasAudio) return [];
  return [`tape/${row.id}.${f === 'doc' ? 'json' : 'wav'}`];
}

// The key, then the legacy URL when the key read finds nothing or fails.
async function readPayload(row, f) {
  return readFirst(refsFor(row, f));
}

async function writeDoc(ownerId, id, payload) {
  const store = await getArtifacts();
  const { key, url } = await store.put(
    docKeyOf(ownerId, id),
    Buffer.from(JSON.stringify(payload)),
    'application/json',
  );
  return { docKey: key, docUrl: url };
}

async function readDoc(row) {
  const buf = await readPayload(row, 'doc');
  return buf ? JSON.parse(buf.toString('utf-8')) : null;
}

async function removePayloads(row) {
  const refs = [refsFor(row, 'doc')[0], refsFor(row, 'audio')[0]].filter(Boolean);
  await (await getArtifacts()).del(refs);
}

// how a take's audio gets in: 'direct' = PUT to our route (local dev has
// no request-size cap); hosted answers 'client' (Blob client upload)
export function audioUploadMode() {
  return ARTIFACT_DRIVER === 'blob' ? 'client' : 'direct';
}

// ---- meta (Postgres) ----

async function rowFor(db, ownerId, id) {
  const rows = await db
    .select()
    .from(tapeTake)
    .where(and(eq(tapeTake.ownerId, ownerId), eq(tapeTake.id, id)))
    .limit(1);
  return rows[0] || null;
}

// Delete tombstones past the 30-day line, payloads first. Costs one
// select unless one actually crossed it. Returns how many went.
export async function purgeTakes(ownerId) {
  const db = await getDb();
  const expired = await db
    .select()
    .from(tapeTake)
    .where(
      and(
        eq(tapeTake.ownerId, ownerId),
        lt(tapeTake.deletedAt, new Date(Date.now() - PURGE_MS)),
      ),
    );
  for (const row of expired) {
    await removePayloads(row);
    await db.delete(tapeTake).where(eq(tapeTake.id, row.id));
  }
  return expired.length;
}

export async function listTakes(ownerId) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tapeTake)
    .where(and(eq(tapeTake.ownerId, ownerId), isNull(tapeTake.deletedAt)))
    .orderBy(desc(tapeTake.createdAt));
  return rows.map(toMeta);
}

export async function getTake(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  return row ? toMeta(row) : null;
}

export async function createTake(ownerId, { name, seconds, sampleRate, noteCount, payload }) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const doc = await writeDoc(ownerId, id, payload);
  await db.insert(tapeTake).values({
    id,
    ownerId,
    name,
    seconds,
    sampleRate,
    noteCount,
    hasAudio: false,
    ...doc,
    audioKey: null,
    audioUrl: null,
  });
  return getTake(ownerId, id);
}

// Update a saved take in place (the session is tied to it): new payload,
// meta refreshed; the audio is untouched — a recording never changes
// after its decode, so updates cost KBs, not a WAV re-upload.
export async function updateTake(ownerId, id, { name, noteCount, payload }) {
  if (!safeId(id)) throw new Error('no such take');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) throw new Error('no such take');

  const store = await getArtifacts();
  const oldDoc = refsFor(row, 'doc')[0];
  const doc = await writeDoc(ownerId, id, payload);
  const set = { ...doc, updatedAt: new Date() };
  // A local take from before keys moves its WAV under tape/{owner}/
  // along with the document.
  let oldAudio = null;
  if (row.hasAudio && !row.audioKey && !row.audioUrl) {
    const legacy = refsFor(row, 'audio')[0];
    const wav = await store.get(legacy);
    if (wav) {
      const moved = await store.put(audioKeyOf(ownerId, id), wav, 'audio/wav');
      Object.assign(set, { audioKey: moved.key, audioUrl: moved.url });
      oldAudio = legacy;
    }
  }
  if (typeof name === 'string' && name.trim()) set.name = name.trim().slice(0, 80);
  if (Number.isFinite(noteCount)) set.noteCount = noteCount;
  await db.update(tapeTake).set(set).where(eq(tapeTake.id, id));
  // Old payloads go only once the row points at the new ones. A local
  // update rewrites the same key, which must stay.
  await store.del([oldDoc !== doc.docKey && oldDoc, oldAudio].filter(Boolean));
  return getTake(ownerId, id);
}

// Local dev only: audio arrives as a PUT body on our own route.
export async function saveTakeAudio(ownerId, id, buffer) {
  if (audioUploadMode() !== 'direct') throw new Error('audio upload failed');
  if (!safeId(id)) throw new Error('no such take');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) throw new Error('no such take');
  const store = await getArtifacts();
  const old = refsFor(row, 'audio')[0];
  const { key, url } = await store.put(audioKeyOf(ownerId, id), buffer, 'audio/wav');
  await db
    .update(tapeTake)
    .set({ audioKey: key, audioUrl: url, hasAudio: true, updatedAt: new Date() })
    .where(eq(tapeTake.id, id));
  if (old && old !== key) await store.del([old]);
  return getTake(ownerId, id);
}

// Whether key is one of this take's own recordings, compared by path
// segment: tape/{owner}/{id}.wav as the browser uploads it, with the
// random suffix Blob adds ({id}-{suffix}.wav), or a .wav under
// tape/{owner}/{id}/. A bare string prefix would let take "abc" claim
// take "abcd"'s upload; any other extension would attach a document.
function isTakeAudioKey(key, ownerId, id) {
  const [root, owner, file, ...rest] = key.split('/');
  if (root !== 'tape' || owner !== ownerId || !file) return false;
  if (rest.length) {
    return file === id && key.endsWith('.wav') && !rest.some(s => s === '' || s === '.' || s === '..');
  }
  if (file === `${id}.wav`) return true;
  return file.startsWith(`${id}-`) && /^[\w-]+\.wav$/.test(file.slice(id.length + 1));
}

// Hosted only: the browser uploaded the WAV to Blob; attach it. Only an
// object this store issued, among this take's own keys, is accepted.
// The key is what readers use; audioUrl is still written too, as their
// fallback.
export async function attachTakeAudio(ownerId, id, audioUrl) {
  if (typeof audioUrl !== 'string') throw new Error('audio upload failed');
  if (audioUploadMode() !== 'client') throw new Error("audio upload isn't available here");
  const store = await getArtifacts();
  const key = store.keyFromUrl(audioUrl);
  if (!key || !isTakeAudioKey(key, ownerId, id)) throw new Error('audio upload failed');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) throw new Error('no such take');
  const old = row.audioKey || row.audioUrl;
  await db
    .update(tapeTake)
    .set({ audioKey: key, audioUrl, hasAudio: true, updatedAt: new Date() })
    .where(eq(tapeTake.id, id));
  if (old && old !== key && old !== audioUrl) await store.del([old]);
  return getTake(ownerId, id);
}

export async function getTakePayload(ownerId, id) {
  if (!safeId(id)) return null;
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return null;
  return readDoc(row);
}

export async function getTakeAudio(ownerId, id) {
  if (!safeId(id)) return null;
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return null;
  const [ref] = refsFor(row, 'audio');
  if (!ref) return null;
  // A store with public URLs (Blob) hands out its own: the route
  // redirects. Local reads the file, which the route streams.
  const url = (await getArtifacts()).url(ref);
  if (url) return { url };
  const buffer = await readPayload(row, 'audio');
  return buffer ? { buffer } : null;
}

export async function deleteTake(ownerId, id) {
  if (!safeId(id)) return;
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return;
  await db
    .update(tapeTake)
    .set({ deletedAt: new Date() })
    .where(eq(tapeTake.id, id));
}

export async function restoreTake(ownerId, id) {
  if (!safeId(id)) throw new Error('no such take');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row || !row.deletedAt) throw new Error('nothing to restore');
  await db
    .update(tapeTake)
    .set({ deletedAt: null })
    .where(eq(tapeTake.id, id));
  return getTake(ownerId, id);
}
