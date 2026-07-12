// lib/change-signal.js — cheap "anything to do?" signals that let the
// device's hot polls skip Redis entirely when there is no work.
// See docs/store-costs.md for the economics and the probe results.
//
// Transport is Vercel Blob: reads cost $0.40/M (5x cheaper than Redis
// commands) with no monthly read cap, writes are rare. Probed July 2026
// against the production store: an overwritten flag is visible to a
// cache-busted fetch in 46–184ms. Plain fetches can lag ~2s on the CDN,
// so reads ALWAYS cache-bust.
//
// Two flags, one file each per owner (namespacing rule: per owner, per
// purpose — readers are only woken by changes they care about):
//   queue-flag/{owner}.json  {"hasWork": bool}     guards /next
//   tick-flag/{owner}.json   {"nextDueAt": ms|null} guards /tick
//     (null = no plugin scheduled at all)
//
// Failure policy: never throw, never block the caller's main work. Reads
// return null on any problem ("unknown — go check Redis"), writes log and
// give up; a lost write is bounded by the safety checks in /next and
// /tick.

let blobMod;
async function mod() {
  if (!blobMod) blobMod = await import('@vercel/blob');
  return blobMod;
}

const token = () => process.env.BLOB_READ_WRITE_TOKEN || '';

export function signalsConfigured() {
  return !!token();
}

const flagPath = (purpose, ownerId) =>
  `${purpose}/${String(ownerId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;

// Public blob URLs are https://{storeId}.public.blob.vercel-storage.com/
// {path}; the store id is embedded in the token
// (vercel_blob_rw_{storeId}_{secret}). A put() refreshes the cached URL
// with the authoritative one from the SDK.
const urlCache = new Map(); // "purpose:owner" -> flag URL
function flagUrl(purpose, ownerId) {
  const key = `${purpose}:${ownerId}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const m = /^vercel_blob_rw_([a-zA-Z0-9]+)_/.exec(token());
  if (!m) return null;
  return `https://${m[1]}.public.blob.vercel-storage.com/${flagPath(purpose, ownerId)}`;
}

// Last value written, per flag — skips writes that change nothing (e.g. a
// second job queued while the flag is already true).
const lastWritten = new Map();

async function readFlag(purpose, ownerId) {
  const url = flagUrl(purpose, ownerId);
  if (!url) return null;
  try {
    // Cache-bust every read: plain URLs can serve ~2s stale from the CDN.
    const resp = await fetch(`${url}?cb=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null; // 404 = never written; else unknown
    return await resp.json();
  } catch {
    return null;
  }
}

async function writeFlag(purpose, ownerId, body) {
  if (!token()) return;
  const key = `${purpose}:${ownerId}`;
  const serialized = JSON.stringify(body);
  if (lastWritten.get(key) === serialized) return;
  lastWritten.set(key, serialized);
  try {
    const { put } = await mod();
    const { url } = await put(flagPath(purpose, ownerId), serialized, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: 'application/json',
    });
    urlCache.set(key, url);
  } catch (err) {
    lastWritten.delete(key); // retry on next state change
    console.warn(`[change-signal] ${purpose} write failed: ${err.message}`);
  }
}

// ---- queue flag ----

// true (queue has work), false (verified empty), or null (unknown — caller
// must query Redis). A missing flag counts as unknown, not empty.
export async function readQueueSignal(ownerId) {
  const body = await readFlag('queue-flag', ownerId);
  return body && typeof body.hasWork === 'boolean' ? body.hasWork : null;
}

export async function setQueueSignal(ownerId, hasWork) {
  await writeFlag('queue-flag', ownerId, { hasWork });
}

// ---- tick flag ----

// { nextDueAt: ms | null } (null = no plugin scheduled), or null when the
// flag is missing/unreadable (unknown — caller must do the real claim).
export async function readTickSignal(ownerId) {
  const body = await readFlag('tick-flag', ownerId);
  if (!body || !('nextDueAt' in body)) return null;
  const v = body.nextDueAt;
  return { nextDueAt: typeof v === 'number' ? v : null };
}

export async function setTickSignal(ownerId, nextDueAt) {
  await writeFlag('tick-flag', ownerId, {
    nextDueAt: Number.isFinite(nextDueAt) ? nextDueAt : null,
  });
}
