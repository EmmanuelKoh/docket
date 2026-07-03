// scripts/migrate-json-to-redis.js — one-time import of the local JSON state
// (data/templates.json, data/jobs.json, data/plugins.json,
// data/espn-state.json) into hosted storage (Upstash Redis + Vercel Blob).
//
// Idempotent — safe to re-run: existing Redis data is never overwritten.
// Templates and poller state are written only if their keys are absent; job
// records are skipped individually if their id already exists.
//
// Needs the redis + blob env vars set (see .env.example). Run:
//   node scripts/migrate-json-to-redis.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_ID } from '../config.js';
import { getRedis, rkey } from '../lib/redis.js';
import { putBlob } from '../lib/blob.js';
// Redis driver imported directly (not the facade): this script always writes
// to Redis no matter what STORE_DRIVER is set to locally.
import {
  getPlugin as getPluginRedis,
  upsertPlugin as upsertPluginRedis,
} from '../lib/stores/plugins-redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  } catch {
    return null;
  }
}

const redis = await getRedis();

// ---- templates ----
const templates = readJson('templates.json');
if (templates) {
  const withOwner = templates.map(t => ({ ...t, ownerId: t.ownerId || OWNER_ID }));
  const created = await redis.set(rkey('templates'), withOwner, { nx: true });
  console.log(created
    ? `templates: imported ${withOwner.length}`
    : 'templates: already in Redis, skipped');
} else {
  console.log('templates: no data/templates.json, skipped');
}

// ---- jobs ----
const jobs = readJson('jobs.json');
if (jobs) {
  let imported = 0;
  let skipped = 0;
  let maxId = 0;
  for (const job of jobs) {
    const m = job.id.match(/^job-(\d+)$/);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));

    if (await redis.exists(rkey('job', job.id))) {
      skipped++;
      continue;
    }

    const pngUrl = job.png
      ? await putBlob(`jobs/${OWNER_ID}/${job.id}.png`, Buffer.from(job.png, 'base64'), 'image/png')
      : null;
    const bytesUrl = job.bytes
      ? await putBlob(`jobs/${OWNER_ID}/${job.id}.bin`, Buffer.from(job.bytes, 'base64'), 'application/octet-stream')
      : null;

    // A job inflight at migration time never acked — requeue it.
    const status = job.status === 'inflight' ? 'queued' : job.status;

    await redis.set(rkey('job', job.id), {
      id: job.id,
      ownerId: OWNER_ID,
      createdAt: job.createdAt,
      status,
      template: job.template,
      data: job.data,
      pngUrl,
      bytesUrl,
      width: job.width,
      height: job.height,
    });
    await redis.rpush(rkey('jobs', 'index'), job.id);
    if (status === 'queued') await redis.rpush(rkey('jobs', 'queue'), job.id);
    imported++;
  }

  // Keep the id counter ahead of everything imported.
  const seq = Number(await redis.get(rkey('jobs', 'seq'))) || 0;
  if (maxId > seq) await redis.set(rkey('jobs', 'seq'), maxId);

  console.log(`jobs: imported ${imported}, skipped ${skipped} (seq=${Math.max(seq, maxId)})`);
} else {
  console.log('jobs: no data/jobs.json, skipped');
}

// ---- plugin registry ----
const plugins = readJson('plugins.json');
if (plugins) {
  let imported = 0;
  let skipped = 0;
  for (const rec of plugins) {
    const ownerId = rec.ownerId || OWNER_ID;
    if (await getPluginRedis(ownerId, rec.id)) {
      skipped++;
      continue;
    }
    await upsertPluginRedis({ ...rec, ownerId });
    imported++;
  }
  console.log(`plugins: imported ${imported}, skipped ${skipped}`);
} else {
  console.log('plugins: no data/plugins.json, skipped');
}

// ---- espn poller state ----
const espn = readJson('espn-state.json');
if (espn) {
  const created = await redis.set(
    rkey('state', 'espn'),
    { ownerId: OWNER_ID, updatedAt: new Date().toISOString(), data: espn },
    { nx: true }
  );
  console.log(created ? 'espn state: imported' : 'espn state: already in Redis, skipped');
} else {
  console.log('espn state: no data/espn-state.json, skipped');
}

console.log('done');
