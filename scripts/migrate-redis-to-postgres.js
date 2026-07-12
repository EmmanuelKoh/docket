#!/usr/bin/env node
// scripts/migrate-redis-to-postgres.js — one-time copy of the record
// stores into Postgres (phase 4: system of record). Reads wherever the
// records used to live, honoring STORE_DRIVER:
//   redis — rp:{owner}:templates, rp:{owner}:tape:takes,
//           rp:{owner}:job:{id} (via the jobs index), and the plugin
//           records' config slice
//   json  — data/templates.json, data/tape-takes.json, data/jobs.json
// and inserts template / tape_take / job / plugin_config rows. Artifact
// URLs (Blob) and local payload files are carried as-is — nothing heavy
// moves. The Redis queue, lease, plugin state, and due-index are NOT
// migrated: they stay in Redis by design.
//
// Idempotent: inserts use ON CONFLICT DO NOTHING, so an existing Postgres
// row always wins and a re-run only fills gaps.
//
//   node scripts/migrate-redis-to-postgres.js [ownerId]   (default: 'default')
//
// Run AFTER db:migrate. For production: with the prod DATABASE_URL and
// the Upstash env vars set (or run scripts/migrate-owner.js first if you
// are also moving to your account id — order doesn't matter, both are
// idempotent; just pass the owner the data currently sits under).

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DRIVER } from '../config.js';
import { job, pluginConfig, tapeTake, template } from '../db/schema.js';
import { getDb } from '../lib/db.js';

const ownerId = process.argv[2] || 'default';
const db = await getDb();

const asDate = v => (v ? new Date(v) : null);
let total = 0;

async function insert(table, rows, label) {
  if (!rows.length) return;
  await db.insert(table).values(rows).onConflictDoNothing();
  console.log(`${label}: ${rows.length} row(s) offered`);
  total += rows.length;
}

async function readSources() {
  if (STORE_DRIVER === 'redis') {
    const { getRedis, rkey } = await import('../lib/redis.js');
    const redis = await getRedis();
    const templates = (await redis.get(rkey(ownerId, 'templates'))) || [];
    const takes = (await redis.get(rkey(ownerId, 'tape', 'takes'))) || [];
    const jobIds = await redis.lrange(rkey(ownerId, 'jobs', 'index'), 0, -1);
    const jobs = jobIds.length
      ? (await redis.mget(...jobIds.map(id => rkey(ownerId, 'job', id)))).filter(Boolean)
      : [];
    const pluginIds = await redis.smembers(rkey(ownerId, 'plugins', 'ids'));
    const plugins = pluginIds.length
      ? (await redis.mget(...pluginIds.map(id => rkey(ownerId, 'plugin', id)))).filter(Boolean)
      : [];
    return { templates, takes, jobs, plugins };
  }

  const DATA = path.join(process.cwd(), 'data');
  const readJson = f =>
    fs.existsSync(path.join(DATA, f))
      ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf-8'))
      : [];
  const owned = r => (r.ownerId || 'default') === ownerId;
  return {
    templates: readJson('templates.json').filter(owned),
    takes: readJson('tape-takes.json').filter(owned),
    jobs: readJson('jobs.json').filter(owned),
    plugins: readJson('plugins.json').filter(owned),
  };
}

const { templates, takes, jobs, plugins } = await readSources();

await insert(
  template,
  templates.map(t => ({
    ownerId,
    name: t.name,
    template: t.template,
    data: t.data ?? null,
    updatedAt: asDate(t.updatedAt) || new Date(),
  })),
  'templates',
);

await insert(
  tapeTake,
  takes.map(t => ({
    id: t.id,
    ownerId,
    name: t.name,
    createdAt: asDate(t.createdAt) || new Date(),
    updatedAt: asDate(t.updatedAt) || new Date(),
    seconds: t.seconds ?? null,
    sampleRate: t.sampleRate ?? null,
    noteCount: t.noteCount ?? null,
    hasAudio: !!t.hasAudio,
    docUrl: t.docUrl ?? null,
    audioUrl: t.audioUrl ?? null,
    deletedAt: asDate(t.deletedAt),
  })),
  'tape takes',
);

await insert(
  job,
  jobs.map(j => ({
    ownerId,
    id: j.id,
    createdAt: asDate(j.createdAt) || new Date(),
    status: j.status,
    name: j.name || '',
    source: j.source || '',
    template: j.template ?? null,
    data: j.data ?? null,
    dataUrl: j.dataUrl ?? null,
    pngUrl: j.pngUrl ?? null,
    bytesUrl: j.bytesUrl ?? null,
    png: j.png ?? null,
    bytes: j.bytes ?? null,
    width: j.width ?? null,
    height: j.height ?? null,
    claimedAt: asDate(j.claimedAt),
  })),
  'jobs',
);

await insert(
  pluginConfig,
  plugins.map(p => ({
    ownerId,
    pluginId: p.id,
    enabled: !!p.enabled,
    schedule: p.schedule ?? null,
    config: p.config ?? {},
    updatedAt: new Date(),
  })),
  'plugin configs',
);

console.log(
  total
    ? `\noffered ${total} row(s) to Postgres for owner '${ownerId}' (existing rows won conflicts).`
    : `nothing found under owner '${ownerId}' in the ${STORE_DRIVER} store.`,
);
