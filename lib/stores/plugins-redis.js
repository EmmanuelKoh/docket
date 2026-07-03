// Plugin registry: Redis driver (Upstash).
//
// Layout (keys take an explicit ownerId — the registry API is owner-scoped):
//   rp:{owner}:plugin:{id}          registry record
//   rp:{owner}:plugins:ids          set of registered plugin ids
//   rp:{owner}:plugin:{id}:running  run lock (SET NX PX) — overlap guard
//
// The run lock reuses the lease pattern from the job queue: an atomic
// claim with an expiry, so a crashed run can never wedge a plugin forever.

import { getRedis } from '../redis.js';

const pkey = (ownerId, ...parts) => ['rp', ownerId, 'plugin', ...parts].join(':');
const idsKey = ownerId => ['rp', ownerId, 'plugins', 'ids'].join(':');

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

export async function upsertPlugin(record) {
  const redis = await getRedis();
  await redis.set(pkey(record.ownerId, record.id), record);
  await redis.sadd(idsKey(record.ownerId), record.id);
  return record;
}

async function patch(ownerId, id, fields) {
  const record = await getPlugin(ownerId, id);
  if (!record) return null;
  return upsertPlugin({ ...record, ...fields });
}

export async function setEnabled(ownerId, id, enabled) {
  return patch(ownerId, id, { enabled: !!enabled });
}

export async function updateState(ownerId, id, state) {
  return patch(ownerId, id, { state });
}

export async function updateConfig(ownerId, id, config) {
  return patch(ownerId, id, { config });
}

// ---- run lock (overlap guard) ----

export async function tryAcquireRunLock(ownerId, id, ttlSeconds) {
  const redis = await getRedis();
  const ok = await redis.set(pkey(ownerId, id, 'running'), '1', {
    nx: true,
    px: ttlSeconds * 1000,
  });
  return ok === 'OK';
}

export async function releaseRunLock(ownerId, id) {
  const redis = await getRedis();
  await redis.del(pkey(ownerId, id, 'running'));
}
