// Poller/plugin state: Redis driver (Upstash).
// Each state key is one Redis key (rp:{owner}:state:{name}) holding an
// envelope { ownerId, updatedAt, data } — data is the state object itself.

import { getRedis, rkey } from '../redis.js';

export async function getState(ownerId, name) {
  const redis = await getRedis();
  const wrapped = await redis.get(rkey(ownerId, 'state', name));
  if (!wrapped) return null;
  if (wrapped.ownerId && wrapped.ownerId !== ownerId) return null;
  return wrapped.data ?? null;
}

export async function setState(ownerId, name, value) {
  const redis = await getRedis();
  await redis.set(rkey(ownerId, 'state', name), {
    ownerId,
    updatedAt: new Date().toISOString(),
    data: value,
  });
}
