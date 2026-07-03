// lib/store.js — template storage.
// Local dev: reads/writes data/templates.json (seeded from starter templates).
// Vercel: read-only from reference/starter-templates.json.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'templates.json');
const STARTER_FILE = path.join(ROOT, 'reference', 'starter-templates.json');

const READ_ONLY = !!process.env.VERCEL;

function loadStarters() {
  return JSON.parse(fs.readFileSync(STARTER_FILE, 'utf-8'));
}

function readStore() {
  if (READ_ONLY) return loadStarters();
  if (!fs.existsSync(DATA_FILE)) {
    // seed from starter templates on first access
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const starters = loadStarters();
    fs.writeFileSync(DATA_FILE, JSON.stringify(starters, null, 2));
    return starters;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeStore(templates) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(templates, null, 2));
}

export function isReadOnly() {
  return READ_ONLY;
}

export function getTemplates() {
  return readStore();
}

export function saveTemplate({ name, template, data }) {
  if (READ_ONLY) {
    throw new Error('Saving is not enabled on the hosted version yet.');
  }
  const templates = readStore();
  const idx = templates.findIndex(t => t.name === name);
  const entry = { name, template, data };
  if (idx >= 0) {
    templates[idx] = entry;
  } else {
    templates.push(entry);
  }
  writeStore(templates);
  return templates;
}

export function deleteTemplate(name) {
  if (READ_ONLY) {
    throw new Error('Deleting is not enabled on the hosted version yet.');
  }
  const templates = readStore().filter(t => t.name !== name);
  writeStore(templates);
  return templates;
}
