// Poller/plugin state: JSON-file driver (local dev fallback).
// One file per owner+key. The original owner ('default') keeps the
// pre-accounts filenames (data/{name}-state.json — the ESPN poller's key
// 'espn' still maps to data/espn-state.json, nothing moves); other owners
// get data/{name}-state.{owner}.json.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

const safe = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
const fileFor = (ownerId, name) =>
  ownerId === 'default'
    ? path.join(DATA_DIR, `${safe(name)}-state.json`)
    : path.join(DATA_DIR, `${safe(name)}-state.${safe(ownerId)}.json`);

export async function getState(ownerId, name) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(ownerId, name), 'utf-8'));
  } catch {
    return null;
  }
}

export async function setState(ownerId, name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileFor(ownerId, name), JSON.stringify(value, null, 2));
}
