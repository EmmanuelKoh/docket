#!/usr/bin/env node
// scripts/migrate-owner.js — reassign every stored record from one owner
// id to another. The one-time step that hands the pre-accounts data
// (ownerId 'default') to your real account:
//
//   node scripts/create-user.js "Name" you@example.com password
//   node scripts/migrate-owner.js default <your-user-id> [--dry-run]
//
// Honors STORE_DRIVER like everything else: json rewrites the ownerId
// fields in the data/ files; redis copies every rp:{from}:* key to
// rp:{to}:* (type-aware) and deletes the originals. Blob artifacts are
// NOT moved: job/tape records store full URLs, which keep working; only
// NEW writes use the new owner's prefix. Idempotent — a second run finds
// nothing left to move.
//
// AFTER a redis migration, update the OWNER_ID env var (locally in .env,
// hosted in Vercel) to the new owner id: the device endpoints (/next,
// /ack, /nack, /tick) still serve the OWNER_ID queue until device
// pairing lands. The script prints a reminder.

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DRIVER } from '../config.js';

const [from, to, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';

if (!from || !to || from === to) {
  console.error('usage: node scripts/migrate-owner.js <from-owner> <to-owner> [--dry-run]');
  process.exit(1);
}

const relabel = record =>
  record && typeof record === 'object' && !Array.isArray(record)
    ? { ...record, ...(record.ownerId !== undefined || record.id ? { ownerId: to } : {}) }
    : record;

async function migrateJson() {
  const DATA_DIR = path.join(process.cwd(), 'data');
  let moved = 0;

  // Array-of-records files: rewrite matching ownerId fields in place.
  for (const file of ['jobs.json', 'templates.json', 'tape-takes.json', 'plugins.json']) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const records = JSON.parse(fs.readFileSync(p, 'utf-8'));
    let n = 0;
    for (const r of records) {
      if ((r.ownerId || 'default') === from) {
        r.ownerId = to;
        n++;
      }
    }
    if (n && !dryRun) fs.writeFileSync(p, JSON.stringify(records, null, 2));
    if (n) console.log(`${file}: ${n} record(s)${dryRun ? ' (dry run)' : ''}`);
    moved += n;
  }

  // State files: {name}-state.json (from='default') → {name}-state.{to}.json.
  if (fs.existsSync(DATA_DIR)) {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const isFromFile =
        from === 'default'
          ? /^[a-zA-Z0-9_-]+-state\.json$/.test(f)
          : f.endsWith(`-state.${from}.json`);
      if (!isFromFile) continue;
      const name = f.replace(`-state.${from}.json`, '').replace('-state.json', '');
      const target =
        to === 'default' ? `${name}-state.json` : `${name}-state.${to}.json`;
      if (!dryRun) fs.renameSync(path.join(DATA_DIR, f), path.join(DATA_DIR, target));
      console.log(`${f} -> ${target}${dryRun ? ' (dry run)' : ''}`);
      moved++;
    }
  }
  return moved;
}

async function migrateRedis() {
  const { getRedis } = await import('../lib/redis.js');
  const redis = await getRedis();
  const prefix = `rp:${from}:`;
  let cursor = 0;
  let moved = 0;

  do {
    const [next, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
    cursor = Number(next);
    for (const key of keys) {
      const newKey = `rp:${to}:${key.slice(prefix.length)}`;
      const type = await redis.type(key);
      console.log(`${key} -> ${newKey} (${type})${dryRun ? ' (dry run)' : ''}`);
      moved++;
      if (dryRun) continue;

      if (type === 'string') {
        // Upstash auto-JSONs values; records and record-arrays get their
        // ownerId fields rewritten on the way through.
        let value = await redis.get(key);
        if (Array.isArray(value)) value = value.map(relabel);
        else value = relabel(value);
        await redis.set(newKey, value);
      } else if (type === 'list') {
        const items = await redis.lrange(key, 0, -1);
        if (items.length) {
          await redis.del(newKey);
          await redis.rpush(newKey, ...items);
        }
      } else if (type === 'zset') {
        const entries = await redis.zrange(key, 0, -1, { withScores: true });
        for (let i = 0; i < entries.length; i += 2) {
          await redis.zadd(newKey, { score: Number(entries[i + 1]), member: entries[i] });
        }
      } else if (type === 'set') {
        const members = await redis.smembers(key);
        if (members.length) await redis.sadd(newKey, ...members);
      } else {
        console.warn(`  skipping unsupported type ${type}`);
        continue;
      }
      await redis.del(key);
    }
  } while (cursor !== 0);
  return moved;
}

// Postgres record stores (phase 4): flip ownerId on every table that
// carries one. Runs for both drivers — Postgres is always present.
async function migratePostgres() {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../lib/db.js');
  const schema = await import('../db/schema.js');
  const db = await getDb();
  let moved = 0;
  const tables = [
    ['template', schema.template, schema.template.ownerId],
    ['job', schema.job, schema.job.ownerId],
    ['tape_take', schema.tapeTake, schema.tapeTake.ownerId],
    ['plugin_config', schema.pluginConfig, schema.pluginConfig.ownerId],
    ['device', schema.device, schema.device.ownerId],
  ];
  for (const [label, table, col] of tables) {
    if (dryRun) {
      const rows = await db.select().from(table).where(eq(col, from));
      if (rows.length) console.log(`pg ${label}: ${rows.length} row(s) (dry run)`);
      moved += rows.length;
      continue;
    }
    const updated = await db
      .update(table)
      .set({ ownerId: to })
      .where(eq(col, from))
      .returning();
    if (updated.length) console.log(`pg ${label}: ${updated.length} row(s)`);
    moved += updated.length;
    // A re-owned device must have its Redis token mirror rewritten too,
    // or its printer keeps resolving to the old owner until revoked.
    if (label === 'device' && STORE_DRIVER === 'redis') {
      const { getRedis } = await import('../lib/redis.js');
      const redis = await getRedis();
      for (const d of updated) {
        if (!d.tokenHash) continue;
        await redis.set(`rp:_devices:token:${d.tokenHash}`, {
          ownerId: to,
          deviceId: d.id,
        });
        console.log(`  refreshed token mirror for device ${d.id}`);
      }
    }
  }
  return moved;
}

const moved =
  (STORE_DRIVER === 'redis' ? await migrateRedis() : await migrateJson()) +
  (await migratePostgres());

if (!moved) {
  console.log(`nothing stored under owner '${from}' — already migrated?`);
} else if (!dryRun) {
  console.log(`\nmigrated ${moved} item(s) from '${from}' to '${to}'.`);
  console.log(
    `REMINDER: set OWNER_ID=${to} (locally in .env; hosted in the Vercel env)` +
      ` so the printer keeps pulling from the right queue until device pairing lands.`,
  );
}
