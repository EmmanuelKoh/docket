// lib/devices.js — device identity: pairing, per-device bearer tokens,
// and the hot-path token check.
//
// System of record: the device table in Postgres. But /next polls every
// 3 seconds, so steady-state verification NEVER queries Postgres (or it
// would never scale to zero — the hard rule). The layers, fastest first:
//   1. in-memory cache per warm instance (TTL below; the 3s polling keeps
//      instances warm, so in practice this answers nearly every poll)
//   2. redis driver: a mirror key rp:_devices:token:{sha256} written at
//      claim time — one GET per cold start
//   3. Postgres itself — only on a mirror miss (fresh deploy, flushed
//      Redis); the hit rewrites the mirror, so this self-heals
// The json driver (local dev) skips layer 2 and reads PGlite directly —
// no meter to protect locally.
//
// Pairing lifecycle (the pairing-code flow):
//   device POSTs /pair {hardwareId}        -> row born unclaimed, gets a
//                                             short-lived code to print
//   owner enters the code on /printer      -> claim: ownerId + name set,
//                                             token minted (hash stored,
//                                             plaintext parked in the row)
//   device polls /pair {hardwareId, code}  -> collects the plaintext token
//                                             ONCE; row keeps only the hash
// Re-pairing is allowed any time (physical control of the device is the
// authority) — a new code voids nothing until the new claim replaces the
// token.

import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { STORE_DRIVER } from '../config.js';
import { device } from '../db/schema.js';
import { getDb } from './db.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;

// No 0/O/1/I — the code is read off a receipt and typed by a human.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha256 = token => crypto.createHash('sha256').update(token).digest('hex');
const mirrorKey = hash => `rp:_devices:token:${hash}`;

// hash -> { identity: {ownerId, deviceId} | null, at }
const cache = new Map();

function makeCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

async function writeMirror(hash, identity) {
  if (STORE_DRIVER !== 'redis') return;
  const { getRedis } = await import('./redis.js');
  const redis = await getRedis();
  await redis.set(mirrorKey(hash), identity);
}

async function dropMirror(hash) {
  if (STORE_DRIVER !== 'redis') return;
  const { getRedis } = await import('./redis.js');
  const redis = await getRedis();
  await redis.del(mirrorKey(hash));
}

// ---- pairing ----

// Device side, step 1: announce the hardware id, receive a code to print.
export async function beginPairing(hardwareId) {
  const db = await getDb();
  const code = makeCode();
  const expires = new Date(Date.now() + CODE_TTL_MS);
  const existing = await db
    .select({ id: device.id })
    .from(device)
    .where(eq(device.hardwareId, hardwareId))
    .limit(1);
  if (existing.length) {
    await db
      .update(device)
      .set({ pairCode: code, pairCodeExpiresAt: expires })
      .where(eq(device.hardwareId, hardwareId));
  } else {
    await db.insert(device).values({
      id: crypto.randomUUID(),
      hardwareId,
      pairCode: code,
      pairCodeExpiresAt: expires,
    });
  }
  return { code, ttlSeconds: CODE_TTL_MS / 1000 };
}

// Device side, step 2 (polled): collect the token once the owner claimed
// the code. Returns { token } exactly once, null while pending/expired.
export async function pollPairing(hardwareId, code) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(device)
    .where(and(eq(device.hardwareId, hardwareId), eq(device.pairCode, code)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.ownerId || !row.tokenPlain) return null;

  const token = row.tokenPlain;
  await db
    .update(device)
    .set({
      tokenPlain: null,
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedAt: new Date(),
    })
    .where(eq(device.id, row.id));
  return { token };
}

// Dashboard side: the owner types the printed code. Mints the token.
export async function claimDevice(ownerId, code, name) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(device)
    .where(
      and(eq(device.pairCode, code), gt(device.pairCodeExpiresAt, new Date())),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  if (row.tokenHash) {
    // Re-pair: the old token dies with the claim.
    await dropMirror(row.tokenHash);
    cache.delete(row.tokenHash);
  }
  await db
    .update(device)
    .set({
      ownerId,
      name: (name || '').trim().slice(0, 60) || 'printer',
      tokenHash: hash,
      tokenPlain: token,
      revokedAt: null,
    })
    .where(eq(device.id, row.id));
  await writeMirror(hash, { ownerId, deviceId: row.id });
  return { id: row.id, name: name || 'printer' };
}

// ---- dashboard management ----

export async function listDevices(ownerId) {
  const db = await getDb();
  return db
    .select({
      id: device.id,
      name: device.name,
      hardwareId: device.hardwareId,
      pairedAt: device.pairedAt,
      revokedAt: device.revokedAt,
    })
    .from(device)
    .where(and(eq(device.ownerId, ownerId), isNull(device.revokedAt)));
}

export async function revokeDevice(ownerId, id) {
  const db = await getDb();
  const rows = await db
    .select({ tokenHash: device.tokenHash })
    .from(device)
    .where(and(eq(device.id, id), eq(device.ownerId, ownerId)))
    .limit(1);
  if (!rows.length) return false;
  await db
    .update(device)
    .set({ revokedAt: new Date() })
    .where(and(eq(device.id, id), eq(device.ownerId, ownerId)));
  if (rows[0].tokenHash) {
    await dropMirror(rows[0].tokenHash);
    cache.delete(rows[0].tokenHash);
    // Other warm instances hold their cache up to CACHE_TTL_MS — a revoked
    // device dies within 5 minutes everywhere, instantly here.
  }
  return true;
}

// ---- hot path ----

export async function resolveDeviceToken(token) {
  const hash = sha256(token);

  const hit = cache.get(hash);
  if (hit) {
    const ttl = hit.identity ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.identity;
    cache.delete(hash);
  }

  let identity = null;
  if (STORE_DRIVER === 'redis') {
    const { getRedis } = await import('./redis.js');
    const redis = await getRedis();
    identity = (await redis.get(mirrorKey(hash))) || null;
  }
  if (!identity) {
    // Mirror miss (json driver, fresh Redis, or a bad token): ask the
    // system of record, and repair the mirror on a hit.
    const db = await getDb();
    const rows = await db
      .select({ id: device.id, ownerId: device.ownerId })
      .from(device)
      .where(and(eq(device.tokenHash, hash), isNull(device.revokedAt)))
      .limit(1);
    if (rows[0]?.ownerId) {
      identity = { ownerId: rows[0].ownerId, deviceId: rows[0].id };
      await writeMirror(hash, identity);
    }
  }

  cache.set(hash, { identity, at: Date.now() });
  return identity;
}
