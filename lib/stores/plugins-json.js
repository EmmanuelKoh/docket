// Plugin registry: JSON-file driver (local dev fallback). data/plugins.json.
// Records: { id, ownerId, enabled, schedule, nextDueAt, lastRunAt, config,
//            state, lastError, lastErrorAt }
//
// The due-index is implicit: local file reads are free, so "what's due?"
// scans the records. claimDuePlugins mirrors the Redis driver's semantics
// (return due ids, bump their nextDueAt by a lease) so the runner behaves
// identically under both drivers.

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

export async function upsertPlugin(record, _opts = {}) {
  const records = readStore();
  const idx = records.findIndex(p => p.ownerId === record.ownerId && p.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  writeStore(records);
  return record;
}

export async function claimDuePlugins(ownerId, nowMs, leaseSeconds) {
  const records = readStore();
  const due = records.filter(p =>
    p.ownerId === ownerId && p.enabled &&
    Number.isFinite(p.nextDueAt) && p.nextDueAt <= nowMs);
  if (!due.length) return [];
  for (const p of due) p.nextDueAt = nowMs + leaseSeconds * 1000;
  writeStore(records);
  return due.map(p => p.id);
}
