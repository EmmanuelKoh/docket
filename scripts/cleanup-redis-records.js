#!/usr/bin/env node
// scripts/cleanup-redis-records.js — delete the Redis record keys that
// Postgres replaced (templates, tape-take meta, job records and their
// index). Run once per owner after migrate-redis-to-postgres has done its
// job and the dashboard reads from Postgres. The hot-path keys stay:
// queue, inflight lease, seq, plugin records/due-index, state.
//
//   node scripts/cleanup-redis-records.js <ownerId> [--dry-run]
//
// Needs the Redis env vars (run with the production values, like the
// migrate scripts). Idempotent — a second run finds nothing.

import { getRedis } from '../lib/redis.js';

const [ownerId, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';

if (!ownerId) {
  console.error('usage: node scripts/cleanup-redis-records.js <ownerId> [--dry-run]');
  process.exit(1);
}

const redis = await getRedis();
let removed = 0;

async function del(key) {
  console.log(`${key}${dryRun ? ' (dry run)' : ''}`);
  removed++;
  if (!dryRun) await redis.del(key);
}

// The single-key stores.
for (const key of [`rp:${ownerId}:templates`, `rp:${ownerId}:tape:takes`]) {
  if (await redis.exists(key)) await del(key);
}

// Job records (rp:{owner}:job:{id} — distinct from the live rp:{owner}:jobs:*
// queue keys) and the creation-order index that only they used.
let cursor = 0;
do {
  const [next, keys] = await redis.scan(cursor, {
    match: `rp:${ownerId}:job:*`,
    count: 100,
  });
  cursor = Number(next);
  for (const key of keys) await del(key);
} while (cursor !== 0);

if (await redis.exists(`rp:${ownerId}:jobs:index`)) {
  await del(`rp:${ownerId}:jobs:index`);
}

console.log(
  removed
    ? `${dryRun ? 'would remove' : 'removed'} ${removed} key(s) for owner '${ownerId}'.`
    : `nothing to clean for owner '${ownerId}'.`,
);
process.exit(0);
