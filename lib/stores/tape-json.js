// Tape takes: JSON-file driver (local dev fallback).
// The meta list lives in data/tape-takes.json; each take's payload (the
// take document + the control settings) in data/tape/{id}.json and its
// audio in data/tape/{id}.wav. Vercel's filesystem is read-only, so
// writes are disabled there — deploy with STORE_DRIVER=redis.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_ID } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const META_FILE = path.join(DATA_DIR, 'tape-takes.json');
const TAKE_DIR = path.join(DATA_DIR, 'tape');

const READ_ONLY = !!process.env.VERCEL;
const mine = t => !t.ownerId || t.ownerId === OWNER_ID;
// ids are server-minted UUIDs; anything else never touches the filesystem
const safeId = id => /^[a-z0-9-]{8,64}$/i.test(id);

// soft delete: a deleted take is tombstoned (deletedAt) and hidden, its
// payloads untouched — an unrepeatable recording deserves better than
// one confirm dialog between a click and permanent loss. Tombstones
// older than this are purged for real, lazily, on list reads.
const PURGE_MS = 30 * 24 * 3600 * 1000;

function readMeta() {
  if (!fs.existsSync(META_FILE)) return [];
  return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')).filter(mine);
}

function writeMeta(takes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(takes, null, 2));
}

function assertWritable() {
  if (READ_ONLY) throw new Error('saving takes needs STORE_DRIVER=redis when hosted');
}

// how a take's audio gets in: 'direct' = PUT to our route (local dev has
// no request-size cap); the redis driver answers 'client' (Blob upload)
export function audioUploadMode() {
  return 'direct';
}

function removePayloads(id) {
  for (const ext of ['json', 'wav']) {
    const file = path.join(TAKE_DIR, `${id}.${ext}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

export async function listTakes() {
  let takes = readMeta();
  // lazy purge of expired tombstones (writes are impossible when hosted
  // with this driver anyway)
  if (!READ_ONLY) {
    const cutoff = Date.now() - PURGE_MS;
    const expired = takes.filter(
      t => t.deletedAt && Date.parse(t.deletedAt) < cutoff,
    );
    if (expired.length) {
      for (const t of expired) removePayloads(t.id);
      takes = takes.filter(t => !expired.includes(t));
      writeMeta(takes);
    }
  }
  return takes.filter(t => !t.deletedAt);
}

export async function getTake(id) {
  return readMeta().find(t => t.id === id) || null;
}

export async function createTake({ name, seconds, sampleRate, noteCount, payload }) {
  assertWritable();
  fs.mkdirSync(TAKE_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const take = {
    id, ownerId: OWNER_ID, name,
    createdAt: now, updatedAt: now,
    seconds, sampleRate, noteCount, hasAudio: false,
  };
  fs.writeFileSync(path.join(TAKE_DIR, `${id}.json`), JSON.stringify(payload));
  writeMeta([take, ...readMeta()]);
  return take;
}

// Update a saved take in place (the session is tied to it): rewrite the
// payload and meta; the audio is untouched — a recording never changes
// after its decode, so updates cost KBs, not a WAV re-upload.
export async function updateTake(id, { name, noteCount, payload }) {
  assertWritable();
  if (!safeId(id)) throw new Error('no such take');
  const takes = readMeta();
  const take = takes.find(t => t.id === id);
  if (!take) throw new Error('no such take');
  fs.mkdirSync(TAKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TAKE_DIR, `${id}.json`), JSON.stringify(payload));
  if (typeof name === 'string' && name.trim()) take.name = name.trim().slice(0, 80);
  if (Number.isFinite(noteCount)) take.noteCount = noteCount;
  take.updatedAt = new Date().toISOString();
  writeMeta(takes);
  return take;
}

export async function saveTakeAudio(id, buffer) {
  assertWritable();
  if (!safeId(id)) throw new Error('no such take');
  const takes = readMeta();
  const take = takes.find(t => t.id === id);
  if (!take) throw new Error('no such take');
  fs.mkdirSync(TAKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TAKE_DIR, `${id}.wav`), buffer);
  take.hasAudio = true;
  take.updatedAt = new Date().toISOString();
  writeMeta(takes);
  return take;
}

export async function attachTakeAudio() {
  throw new Error('client uploads need the redis driver');
}

export async function getTakePayload(id) {
  if (!safeId(id)) return null;
  const file = path.join(TAKE_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export async function getTakeAudio(id) {
  if (!safeId(id)) return null;
  const file = path.join(TAKE_DIR, `${id}.wav`);
  if (!fs.existsSync(file)) return null;
  return { buffer: fs.readFileSync(file) };
}

export async function deleteTake(id) {
  assertWritable();
  if (!safeId(id)) return;
  const takes = readMeta();
  const take = takes.find(t => t.id === id);
  if (!take) return;
  take.deletedAt = new Date().toISOString();
  writeMeta(takes);
}

export async function restoreTake(id) {
  assertWritable();
  if (!safeId(id)) throw new Error('no such take');
  const takes = readMeta();
  const take = takes.find(t => t.id === id);
  if (!take || !take.deletedAt) throw new Error('nothing to restore');
  delete take.deletedAt;
  writeMeta(takes);
  return take;
}
