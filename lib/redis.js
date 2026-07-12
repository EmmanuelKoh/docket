// lib/redis.js — Upstash Redis client (lazy singleton) + key namespacing.
// Every key is namespaced by an explicit owner: rp:{ownerId}:... — callers
// pass the owner per call (derived from the session for dashboard traffic,
// from the device for printer traffic).
//
// Connection env vars (either pair works):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash console)
//   KV_REST_API_URL / KV_REST_API_TOKEN                 (Vercel Marketplace)

let client;

export async function getRedis() {
  if (!client) {
    const { Redis } = await import('@upstash/redis');
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        'STORE_DRIVER=redis but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*) are not set'
      );
    }
    client = new Redis({ url, token });
  }
  return client;
}

export function rkey(ownerId, ...parts) {
  return ['rp', ownerId, ...parts].join(':');
}
