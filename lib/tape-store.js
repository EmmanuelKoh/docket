// lib/tape-store.js — saved-takes storage for the Tape tool.
// A take = meta (name, duration, note count) + payload (the take document
// and control settings, JSON) + the recording (16-bit mono WAV, lossless
// on purpose: re-transcription must reproduce the saved tape exactly).
//
// Phase 4 split: take META lives in Postgres (the tape_take table, the
// system of record); the heavy payloads follow STORE_DRIVER —
//   redis — payload JSON + audio WAV in Vercel Blob under tape/{owner}/;
//           audio arrives via the browser's client upload
//           (@vercel/blob/client) because a long WAV exceeds the
//           platform's ~4.5MB request cap
//   json  — payloads and WAVs as files in data/tape/ (local dev)
// Callers never know which is active. All functions are async.
//
// Soft delete: a deleted take is tombstoned (deletedAt) and hidden, its
// payloads untouched — an unrepeatable recording deserves better than one
// confirm dialog between a click and permanent loss. Tombstones older
// than 30 days are purged for real (row + payloads), lazily, on list
// reads.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { STORE_DRIVER } from '../config.js';
import { tapeTake } from '../db/schema.js';
import { getDb } from './db.js';

const PURGE_MS = 30 * 24 * 3600 * 1000;
const HOSTED = STORE_DRIVER === 'redis';

const TAKE_DIR = path.join(process.cwd(), 'data', 'tape');
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
  docUrl: row.docUrl,
  audioUrl: row.audioUrl,
  ...(row.deletedAt ? { deletedAt: row.deletedAt.toISOString() } : {}),
});

// ---- payload driver ----

async function writeDoc(ownerId, id, payload) {
  if (HOSTED) {
    const { putBlob } = await import('./blob.js');
    return putBlob(
      `tape/${ownerId}/${id}.json`,
      Buffer.from(JSON.stringify(payload)),
      'application/json',
    );
  }
  fs.mkdirSync(TAKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TAKE_DIR, `${id}.json`), JSON.stringify(payload));
  return null; // local payloads are found by id, not URL
}

async function readDoc(row) {
  if (row.docUrl) {
    const { fetchBlob } = await import('./blob.js');
    return JSON.parse((await fetchBlob(row.docUrl)).toString('utf-8'));
  }
  const file = path.join(TAKE_DIR, `${row.id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function removePayloads(row) {
  const urls = [row.docUrl, row.audioUrl].filter(Boolean);
  if (urls.length) {
    const { delBlobs } = await import('./blob.js');
    await delBlobs(urls);
  }
  for (const ext of ['json', 'wav']) {
    const file = path.join(TAKE_DIR, `${row.id}.${ext}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// how a take's audio gets in: 'direct' = PUT to our route (local dev has
// no request-size cap); hosted answers 'client' (Blob client upload)
export function audioUploadMode() {
  return HOSTED ? 'client' : 'direct';
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

export async function listTakes(ownerId) {
  const db = await getDb();
  // lazy purge of expired tombstones — costs work only when one actually
  // crosses the 30-day line
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
  const docUrl = await writeDoc(ownerId, id, payload);
  await db.insert(tapeTake).values({
    id,
    ownerId,
    name,
    seconds,
    sampleRate,
    noteCount,
    hasAudio: false,
    docUrl,
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

  const oldDocUrl = row.docUrl;
  const docUrl = await writeDoc(ownerId, id, payload);
  const set = { docUrl, updatedAt: new Date() };
  if (typeof name === 'string' && name.trim()) set.name = name.trim().slice(0, 80);
  if (Number.isFinite(noteCount)) set.noteCount = noteCount;
  await db.update(tapeTake).set(set).where(eq(tapeTake.id, id));
  if (oldDocUrl && oldDocUrl !== docUrl) {
    const { delBlobs } = await import('./blob.js');
    await delBlobs([oldDocUrl]);
  }
  return getTake(ownerId, id);
}

// Local dev only: audio arrives as a PUT body on our own route.
export async function saveTakeAudio(ownerId, id, buffer) {
  if (HOSTED) throw new Error('hosted audio arrives via client upload');
  if (!safeId(id)) throw new Error('no such take');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) throw new Error('no such take');
  fs.mkdirSync(TAKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TAKE_DIR, `${id}.wav`), buffer);
  await db
    .update(tapeTake)
    .set({ hasAudio: true, updatedAt: new Date() })
    .where(eq(tapeTake.id, id));
  return getTake(ownerId, id);
}

// Hosted only: the browser uploaded the WAV to Blob; attach its URL.
export async function attachTakeAudio(ownerId, id, audioUrl) {
  if (!HOSTED) throw new Error('client uploads need the redis driver');
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) throw new Error('no such take');
  if (row.audioUrl && row.audioUrl !== audioUrl) {
    const { delBlobs } = await import('./blob.js');
    await delBlobs([row.audioUrl]);
  }
  await db
    .update(tapeTake)
    .set({ audioUrl, hasAudio: true, updatedAt: new Date() })
    .where(eq(tapeTake.id, id));
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
  if (row.audioUrl) return { url: row.audioUrl };
  const file = path.join(TAKE_DIR, `${id}.wav`);
  if (!fs.existsSync(file)) return null;
  return { buffer: fs.readFileSync(file) };
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
