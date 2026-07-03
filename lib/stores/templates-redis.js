// Templates: Redis driver (Upstash).
// The whole template list lives in one key (rp:{owner}:templates) as a JSON
// array — the same shape as data/templates.json — seeded from
// reference/starter-templates.json on first read. The list is small and
// single-owner, so read-modify-write on one key is fine.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_ID } from '../../config.js';
import { getRedis, rkey } from '../redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const STARTER_FILE = path.join(ROOT, 'reference', 'starter-templates.json');

const KEY = rkey('templates');

export function isReadOnly() {
  return false;
}

async function readStore(redis) {
  const templates = await redis.get(KEY);
  if (templates) return templates;
  const starters = JSON.parse(fs.readFileSync(STARTER_FILE, 'utf-8'))
    .map(t => ({ ...t, ownerId: OWNER_ID }));
  await redis.set(KEY, starters);
  return starters;
}

export async function getTemplates() {
  const redis = await getRedis();
  return readStore(redis);
}

export async function saveTemplate({ name, template, data }) {
  const redis = await getRedis();
  const templates = await readStore(redis);
  const entry = { name, template, data, ownerId: OWNER_ID };
  const idx = templates.findIndex(t => t.name === name);
  if (idx >= 0) {
    templates[idx] = entry;
  } else {
    templates.push(entry);
  }
  await redis.set(KEY, templates);
  return templates;
}

export async function deleteTemplate(name) {
  const redis = await getRedis();
  const templates = (await readStore(redis)).filter(t => t.name !== name);
  await redis.set(KEY, templates);
  return templates;
}
