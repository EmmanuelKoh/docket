// Poller/plugin state: JSON-file driver (local dev fallback).
// One file per state key: data/{name}-state.json. The ESPN poller's key
// 'espn' maps to the pre-existing data/espn-state.json, so nothing moves.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

const fileFor = name => path.join(DATA_DIR, `${name}-state.json`);

export async function getState(name) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf-8'));
  } catch {
    return null;
  }
}

export async function setState(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileFor(name), JSON.stringify(value, null, 2));
}
