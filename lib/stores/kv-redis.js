// kv (lib/kv.js): Redis driver (Upstash). One key per value,
// rp:{scope}:{name}; expiry is the key's own TTL (SET EX), and claim is
// SET NX, so two instances can never both claim the same name.

import { getRedis, rkey } from '../redis.js';

export async function get(scope, name) {
  const redis = await getRedis();
  return (await redis.get(rkey(scope, name))) ?? null;
}

// Returns whether the value was written (false only when ifAbsent found one).
export async function set(scope, name, value, { ttlSeconds, ifAbsent = false } = {}) {
  const redis = await getRedis();
  const opts = {};
  if (ifAbsent) opts.nx = true;
  if (ttlSeconds) opts.ex = ttlSeconds;
  const res = await redis.set(rkey(scope, name), value, Object.keys(opts).length ? opts : undefined);
  return res !== null;
}

export async function del(scope, name) {
  const redis = await getRedis();
  await redis.del(rkey(scope, name));
}
