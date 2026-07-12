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
import { device, deviceMember, user } from '../db/schema.js';
import { getDb } from './db.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;

// No 0/O/1/I — the code is read off a receipt and typed by a human.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha256 = token => crypto.createHash('sha256').update(token).digest('hex');
const mirrorKey = hash => `rp:_devices:token:${hash}`;

// hash -> { identity: {ownerId, deviceId, owners} | null, at }
// ownerId is the device's primary owner; owners = [ownerId, ...members],
// everyone the device prints and ticks for.
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

// [primaryOwner, ...members] — the owner list a device serves.
async function ownersOf(db, deviceId, primaryOwnerId) {
  const rows = await db
    .select({ ownerId: deviceMember.ownerId })
    .from(deviceMember)
    .where(eq(deviceMember.deviceId, deviceId));
  return [primaryOwnerId, ...rows.map(r => r.ownerId)];
}

// Rewrite a device's token mirror from current membership (called on any
// join/leave/remove — dashboard actions, never the polling path).
async function refreshMirror(db, deviceId) {
  const rows = await db
    .select({ ownerId: device.ownerId, tokenHash: device.tokenHash })
    .from(device)
    .where(eq(device.id, deviceId))
    .limit(1);
  const row = rows[0];
  if (!row?.tokenHash || !row.ownerId) return;
  const owners = await ownersOf(db, deviceId, row.ownerId);
  const identity = { ownerId: row.ownerId, deviceId, owners };
  await writeMirror(row.tokenHash, identity);
  cache.set(row.tokenHash, { identity, at: Date.now() });
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
  await writeMirror(hash, { ownerId, deviceId: row.id, owners: [ownerId] });
  return { id: row.id, name: name || 'printer' };
}

// ---- dashboard management ----

// The devices this owner can print to: their own (role 'owner', with any
// active share code so the UI can display it) and ones shared with them
// (role 'member'). primaryOwnerId is whose state slot holds the online
// heartbeat.
export async function listDevices(ownerId) {
  const db = await getDb();
  const own = await db
    .select({
      id: device.id,
      name: device.name,
      hardwareId: device.hardwareId,
      pairedAt: device.pairedAt,
      shareCode: device.shareCode,
      shareCodeExpiresAt: device.shareCodeExpiresAt,
    })
    .from(device)
    .where(and(eq(device.ownerId, ownerId), isNull(device.revokedAt)));
  const owned = await Promise.all(
    own.map(async d => ({
      ...d,
      shareCode:
        d.shareCode && d.shareCodeExpiresAt > new Date() ? d.shareCode : null,
      role: 'owner',
      primaryOwnerId: ownerId,
      // member emails so the owner's UI can say who, not just how many
      members: await db
        .select({ ownerId: deviceMember.ownerId, email: user.email })
        .from(deviceMember)
        .innerJoin(user, eq(user.id, deviceMember.ownerId))
        .where(eq(deviceMember.deviceId, d.id)),
    })),
  );
  const shared = await db
    .select({
      id: device.id,
      name: device.name,
      hardwareId: device.hardwareId,
      pairedAt: device.pairedAt,
      primaryOwnerId: device.ownerId,
    })
    .from(deviceMember)
    .innerJoin(device, eq(deviceMember.deviceId, device.id))
    .where(and(eq(deviceMember.ownerId, ownerId), isNull(device.revokedAt)));
  return [
    ...owned,
    ...shared.map(d => ({ ...d, role: 'member', shareCode: null, members: [] })),
  ];
}

// ---- sharing ----

// Owner mints a short-lived, single-use share code, shown in the
// dashboard. Another account enters it to join the device.
export async function mintShareCode(ownerId, deviceId) {
  const db = await getDb();
  const code = makeCode();
  const updated = await db
    .update(device)
    .set({
      shareCode: code,
      shareCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .where(
      and(
        eq(device.id, deviceId),
        eq(device.ownerId, ownerId),
        isNull(device.revokedAt),
      ),
    )
    .returning({ id: device.id });
  if (!updated.length) return null;
  return { code, ttlSeconds: CODE_TTL_MS / 1000 };
}

// A signed-in user enters a share code: adds them as a member and burns
// the code (mint another for a third member).
export async function joinDevice(ownerId, code) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(device)
    .where(
      and(eq(device.shareCode, code), gt(device.shareCodeExpiresAt, new Date())),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt || !row.ownerId) return null;
  if (row.ownerId === ownerId) return null; // already the owner
  await db
    .insert(deviceMember)
    .values({ deviceId: row.id, ownerId })
    .onConflictDoNothing();
  await db
    .update(device)
    .set({ shareCode: null, shareCodeExpiresAt: null })
    .where(eq(device.id, row.id));
  await refreshMirror(db, row.id);
  return { id: row.id, name: row.name || 'printer' };
}

// A member leaves a shared device themselves.
export async function leaveDevice(ownerId, deviceId) {
  const db = await getDb();
  const gone = await db
    .delete(deviceMember)
    .where(
      and(eq(deviceMember.deviceId, deviceId), eq(deviceMember.ownerId, ownerId)),
    )
    .returning({ ownerId: deviceMember.ownerId });
  if (!gone.length) return false;
  await refreshMirror(db, deviceId);
  return true;
}

// The owner removes a member.
export async function removeMember(ownerId, deviceId, memberId) {
  const db = await getDb();
  const owns = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.ownerId, ownerId)))
    .limit(1);
  if (!owns.length) return false;
  const gone = await db
    .delete(deviceMember)
    .where(
      and(eq(deviceMember.deviceId, deviceId), eq(deviceMember.ownerId, memberId)),
    )
    .returning({ ownerId: deviceMember.ownerId });
  if (!gone.length) return false;
  await refreshMirror(db, deviceId);
  return true;
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
  if (identity && !identity.owners) {
    // Mirror written before sharing existed — normalize.
    identity = { ...identity, owners: [identity.ownerId] };
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
      const owners = await ownersOf(db, rows[0].id, rows[0].ownerId);
      identity = { ownerId: rows[0].ownerId, deviceId: rows[0].id, owners };
      await writeMirror(hash, identity);
    }
  }

  cache.set(hash, { identity, at: Date.now() });
  return identity;
}
