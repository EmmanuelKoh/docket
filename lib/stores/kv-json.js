// kv (lib/kv.js): JSON-file driver (local dev). One file, data/kv.json:
// { "<scope>:<name>": { value, expiresAt } }, expiresAt in epoch ms or null.
// An expired entry reads as absent and is dropped on the next write. Each
// call reads and writes the file synchronously, so a claim is atomic within
// the one local process.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../config.js';

const DATA_FILE = path.join(DATA_DIR, 'kv.json');
const id = (scope, name) => `${scope}:${name}`;
const live = (entry, now) => !!entry && (entry.expiresAt == null || entry.expiresAt > now);

function readStore() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeStore(all) {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(all).filter(([, e]) => live(e, now)));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(kept, null, 2));
}

export async function get(scope, name) {
  const entry = readStore()[id(scope, name)];
  return live(entry, Date.now()) ? entry.value : null;
}

// Returns whether the value was written (false only when ifAbsent found one).
export async function set(scope, name, value, { ttlSeconds, ifAbsent = false } = {}) {
  const all = readStore();
  const key = id(scope, name);
  if (ifAbsent && live(all[key], Date.now())) return false;
  all[key] = { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null };
  writeStore(all);
  return true;
}

export async function del(scope, name) {
  const all = readStore();
  if (!(id(scope, name) in all)) return;
  delete all[id(scope, name)];
  writeStore(all);
}
