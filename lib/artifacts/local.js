// lib/artifacts/local.js — the local artifact store (STORE_DRIVER=json):
// one file per key under DATA_DIR (data/tape/{owner}/{id}.json ...). Job
// png/bytes never come here: they ride inline in the job row (inline:
// true), since PGlite is on the same disk. This store issues no URLs; our
// own routes serve its files.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../config.js';

const isUrl = ref => /^https?:\/\//i.test(ref);

// Keys are relative paths built from ids; anything else never touches disk.
function fileFor(key) {
  if (typeof key !== 'string' || !/^[\w./-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`artifact key rejected: ${key}`);
  }
  return path.join(DATA_DIR, key);
}

// contentType is not kept: files carry no type, and readers know theirs.
async function put(key, body) {
  const file = fileFor(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return { key, url: null };
}

async function get(ref) {
  // A legacy URL row (written by the hosted store into a database local
  // dev shares) is a public object: read it where it lives.
  if (isUrl(ref)) {
    const resp = await fetch(ref);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`artifact fetch failed (${resp.status})`);
    return Buffer.from(await resp.arrayBuffer());
  }
  try {
    return fs.readFileSync(fileFor(ref));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// URLs are not ours to delete, and a rejected key names no file of ours.
async function del(refs) {
  for (const ref of refs || []) {
    if (!ref || isUrl(ref)) continue;
    try {
      fs.unlinkSync(fileFor(ref));
    } catch {
      // already gone, or not a key: cleanup never fails the caller
    }
  }
}

/** @type {import('./index.js').ArtifactStore} */
export const localStore = {
  driver: 'local',
  inline: true,
  put,
  get,
  del,
  url: () => null,
  keyFromUrl: () => null,
};
