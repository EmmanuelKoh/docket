// lib/kv.js — small keyed values that may expire: claims and mirrors that
// must outlive a warm instance. Same interface, two drivers, selected by
// STORE_DRIVER: redis (Upstash, key rp:{scope}:{name}) and json (one file,
// data/kv.json). scope is an owner id, or '_<area>' for a value no one
// account owns (as lib/devices.js keeps rp:_devices:token:...).
//
//   get(scope, name)                         value, or null (absent or expired)
//   set(scope, name, value, { ttlSeconds })  write; no ttlSeconds = no expiry
//   claim(scope, name, value, ttlSeconds)    write only if absent; true = claimed
//   del(scope, name)                         remove
//
// Values are JSON. Each call is one Redis command hosted.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/kv-redis.js')
  : await import('./stores/kv-json.js');

export const get = impl.get;
export const del = impl.del;
export const set = (scope, name, value, { ttlSeconds } = {}) =>
  impl.set(scope, name, value, { ttlSeconds, ifAbsent: false });
export const claim = (scope, name, value, ttlSeconds) =>
  impl.set(scope, name, value, { ttlSeconds, ifAbsent: true });
