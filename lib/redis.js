// lib/redis.js — Upstash Redis client (lazy singleton) + key namespacing.
// Every key is namespaced by owner: rp:{OWNER_ID}:... so the schema is
// multi-user-ready even though only one owner exists today.
//
// Connection env vars (either pair works):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash console)
//   KV_REST_API_URL / KV_REST_API_TOKEN                 (Vercel Marketplace)

import { OWNER_ID } from '../config.js';

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

export function rkey(...parts) {
  return ['rp', OWNER_ID, ...parts].join(':');
}
