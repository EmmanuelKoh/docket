// Plugin registry: JSON-file driver (local dev fallback). data/plugins.json.
// Records: { id, ownerId, enabled, intervalSeconds, lastRunAt, config, state,
//            lastError, lastErrorAt }
//
// The run lock is in-process: the json driver only ever serves a single local
// server process, so a Map with expiry timestamps is equivalent to the Redis
// NX lock.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'plugins.json');

function readStore() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeStore(records) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
}

export async function listPlugins(ownerId) {
  return readStore().filter(p => p.ownerId === ownerId);
}

export async function getPlugin(ownerId, id) {
  return readStore().find(p => p.ownerId === ownerId && p.id === id) || null;
}

export async function upsertPlugin(record) {
  const records = readStore();
  const idx = records.findIndex(p => p.ownerId === record.ownerId && p.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  writeStore(records);
  return record;
}

async function patch(ownerId, id, fields) {
  const record = await getPlugin(ownerId, id);
  if (!record) return null;
  return upsertPlugin({ ...record, ...fields });
}

export async function setEnabled(ownerId, id, enabled) {
  return patch(ownerId, id, { enabled: !!enabled });
}

export async function updateState(ownerId, id, state) {
  return patch(ownerId, id, { state });
}

export async function updateConfig(ownerId, id, config) {
  return patch(ownerId, id, { config });
}

// ---- run lock (overlap guard) ----

const locks = new Map(); // "owner:id" -> expiry epoch ms

export async function tryAcquireRunLock(ownerId, id, ttlSeconds) {
  const key = `${ownerId}:${id}`;
  const expiry = locks.get(key);
  if (expiry && expiry > Date.now()) return false;
  locks.set(key, Date.now() + ttlSeconds * 1000);
  return true;
}

export async function releaseRunLock(ownerId, id) {
  locks.delete(`${ownerId}:${id}`);
}
