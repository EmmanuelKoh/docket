// Tape takes: Redis driver (Upstash) + Vercel Blob for the payloads.
// The meta list lives in one key (rp:{owner}:tape:takes) as a JSON array —
// small and single-owner, like templates, so read-modify-write on one key
// is fine and a list read is a single command. Each take's payload JSON
// (the take document + control settings) and its audio WAV live in Blob;
// the meta record holds their URLs, never the bytes. Audio arrives via
// the browser's client upload (@vercel/blob/client) because a long WAV
// exceeds the platform's ~4.5MB request cap.

import crypto from 'crypto';
import { OWNER_ID } from '../../config.js';
import { getRedis, rkey } from '../redis.js';
import { delBlobs, fetchBlob, putBlob } from '../blob.js';

const KEY = rkey('tape', 'takes');
const mine = t => !t.ownerId || t.ownerId === OWNER_ID;

// soft delete: a deleted take is tombstoned (deletedAt) and hidden, its
// blobs untouched — an unrepeatable recording deserves better than one
// confirm dialog between a click and permanent loss. Tombstones older
// than this are purged for real (record + blobs), lazily, on list reads.
const PURGE_MS = 30 * 24 * 3600 * 1000;

async function readMeta(redis) {
  return ((await redis.get(KEY)) || []).filter(mine);
}

export function audioUploadMode() {
  return 'client';
}

export async function listTakes() {
  const redis = await getRedis();
  let takes = await readMeta(redis);
  // lazy purge of expired tombstones — costs commands only when one
  // actually crosses the 30-day line
  const cutoff = Date.now() - PURGE_MS;
  const expired = takes.filter(
    t => t.deletedAt && Date.parse(t.deletedAt) < cutoff,
  );
  if (expired.length) {
    takes = takes.filter(t => !expired.includes(t));
    await redis.set(KEY, takes);
    await delBlobs(expired.flatMap(t => [t.docUrl, t.audioUrl]));
  }
  return takes.filter(t => !t.deletedAt);
}

export async function getTake(id) {
  const redis = await getRedis();
  return (await readMeta(redis)).find(t => t.id === id) || null;
}

export async function createTake({ name, seconds, sampleRate, noteCount, payload }) {
  const redis = await getRedis();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const docUrl = await putBlob(
    `tape/${id}.json`,
    Buffer.from(JSON.stringify(payload)),
    'application/json',
  );
  const take = {
    id, ownerId: OWNER_ID, name,
    createdAt: now, updatedAt: now,
    seconds, sampleRate, noteCount, hasAudio: false,
    docUrl, audioUrl: null,
  };
  await redis.set(KEY, [take, ...(await readMeta(redis))]);
  return take;
}

export async function saveTakeAudio() {
  throw new Error('hosted audio arrives via client upload');
}

// Update a saved take in place (the session is tied to it): new payload
// blob, old one deleted, meta refreshed; the audio blob is untouched — a
// recording never changes after its decode, so updates cost KBs, not a
// WAV re-upload.
export async function updateTake(id, { name, noteCount, payload }) {
  const redis = await getRedis();
  const takes = await readMeta(redis);
  const take = takes.find(t => t.id === id);
  if (!take) throw new Error('no such take');
  const oldDocUrl = take.docUrl;
  take.docUrl = await putBlob(
    `tape/${id}.json`,
    Buffer.from(JSON.stringify(payload)),
    'application/json',
  );
  if (typeof name === 'string' && name.trim()) take.name = name.trim().slice(0, 80);
  if (Number.isFinite(noteCount)) take.noteCount = noteCount;
  take.updatedAt = new Date().toISOString();
  await redis.set(KEY, takes);
  if (oldDocUrl) await delBlobs([oldDocUrl]);
  return take;
}

export async function attachTakeAudio(id, audioUrl) {
  const redis = await getRedis();
  const takes = await readMeta(redis);
  const take = takes.find(t => t.id === id);
  if (!take) throw new Error('no such take');
  if (take.audioUrl && take.audioUrl !== audioUrl) await delBlobs([take.audioUrl]);
  take.audioUrl = audioUrl;
  take.hasAudio = true;
  take.updatedAt = new Date().toISOString();
  await redis.set(KEY, takes);
  return take;
}

export async function getTakePayload(id) {
  const take = await getTake(id);
  if (!take || !take.docUrl) return null;
  return JSON.parse((await fetchBlob(take.docUrl)).toString('utf-8'));
}

export async function getTakeAudio(id) {
  const take = await getTake(id);
  return take && take.audioUrl ? { url: take.audioUrl } : null;
}

export async function deleteTake(id) {
  const redis = await getRedis();
  const takes = await readMeta(redis);
  const take = takes.find(t => t.id === id);
  if (!take) return;
  take.deletedAt = new Date().toISOString();
  await redis.set(KEY, takes);
}

export async function restoreTake(id) {
  const redis = await getRedis();
  const takes = await readMeta(redis);
  const take = takes.find(t => t.id === id);
  if (!take || !take.deletedAt) throw new Error('nothing to restore');
  delete take.deletedAt;
  await redis.set(KEY, takes);
  return take;
}
