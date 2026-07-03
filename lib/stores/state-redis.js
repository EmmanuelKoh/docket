// Poller/plugin state: Redis driver (Upstash).
// Each state key is one Redis key (rp:{owner}:state:{name}) holding an
// envelope { ownerId, updatedAt, data } — data is the state object itself.

import { OWNER_ID } from '../../config.js';
import { getRedis, rkey } from '../redis.js';

export async function getState(name) {
  const redis = await getRedis();
  const wrapped = await redis.get(rkey('state', name));
  if (!wrapped) return null;
  if (wrapped.ownerId && wrapped.ownerId !== OWNER_ID) return null;
  return wrapped.data ?? null;
}

export async function setState(name, value) {
  const redis = await getRedis();
  await redis.set(rkey('state', name), {
    ownerId: OWNER_ID,
    updatedAt: new Date().toISOString(),
    data: value,
  });
}
