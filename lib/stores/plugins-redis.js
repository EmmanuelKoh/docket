// Plugin registry: Redis driver (Upstash).
//
// Layout (keys take an explicit ownerId — the registry API is owner-scoped):
//   rp:{owner}:plugin:{id}     registry record (includes schedule + nextDueAt)
//   rp:{owner}:plugins:ids     set of registered plugin ids
//   rp:{owner}:plugins:due     sorted set: member = plugin id,
//                              score = nextDueAt (epoch ms)
//
// The due-index is derived data, synced from the record on every upsert in
// this one place — no caller manages it directly. There is no separate
// summary value that can drift: "what's due?" is answered by Redis from
// per-plugin scores.
//
// Overlap protection: claimDuePlugins is one atomic Lua script that reads
// the due ids AND bumps their scores by a lease, so two concurrent ticks
// can never both claim the same plugin, and a crashed run re-becomes due
// after the lease — failures produce one late re-run, never a silently
// stopped plugin. This replaces the old per-plugin run-lock keys.

import { getRedis } from '../redis.js';

const pkey = (ownerId, ...parts) => ['rp', ownerId, 'plugin', ...parts].join(':');
const idsKey = ownerId => ['rp', ownerId, 'plugins', 'ids'].join(':');
const dueKey = ownerId => ['rp', ownerId, 'plugins', 'due'].join(':');

export async function listPlugins(ownerId) {
  const redis = await getRedis();
  const ids = await redis.smembers(idsKey(ownerId));
  if (!ids.length) return [];
  const records = await redis.mget(...ids.map(id => pkey(ownerId, id)));
  return records.filter(Boolean);
}

export async function getPlugin(ownerId, id) {
  const redis = await getRedis();
  return (await redis.get(pkey(ownerId, id))) || null;
}

// Save a record and sync the due-index from it. `create` adds the id to the
// registry set — pass false on saves of existing records to skip the
// redundant command on the hot run path.
export async function upsertPlugin(record, { create = true } = {}) {
  const redis = await getRedis();
  await redis.set(pkey(record.ownerId, record.id), record);
  if (create) await redis.sadd(idsKey(record.ownerId), record.id);
  if (record.enabled && Number.isFinite(record.nextDueAt)) {
    await redis.zadd(dueKey(record.ownerId), { score: record.nextDueAt, member: record.id });
  } else {
    await redis.zrem(dueKey(record.ownerId), record.id);
  }
  return record;
}

// Atomically claim every plugin due at `nowMs`: returns their ids and bumps
// their scores to now + lease so no concurrent tick re-claims them. One
// Redis command; empty result = idle tick.
const CLAIM_DUE_LUA = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 20)
for i, id in ipairs(due) do
  redis.call('ZADD', KEYS[1], ARGV[1] + ARGV[2], id)
end
return due
`;

export async function claimDuePlugins(ownerId, nowMs, leaseSeconds) {
  const redis = await getRedis();
  const ids = await redis.eval(CLAIM_DUE_LUA, [dueKey(ownerId)], [nowMs, leaseSeconds * 1000]);
  return ids || [];
}
