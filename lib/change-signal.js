// lib/change-signal.js — the queue flag: a cheap "is there work?" signal
// that lets the hot /next poll skip Redis when the queue is empty.
// See docs/store-costs.md for the economics and the probe results.
//
// Transport is Vercel Blob: reads cost $0.40/M (5x cheaper than Redis
// commands) with no monthly read cap, writes are rare (two per print).
// Probed July 2026 against the production store: an overwritten flag is
// visible to a cache-busted fetch in 46–184ms. Plain fetches can lag ~2s
// on the CDN, so reads ALWAYS cache-bust.
//
// One flag per owner (queue-flag/{ownerId}.json, body {"hasWork": bool}).
// Namespacing rule: per owner, per purpose — a future signal for another
// purpose gets its own file, so readers are only woken by changes they
// care about.
//
// Failure policy: never throw, never block the caller's main work. Reads
// return null on any problem ("unknown — go check Redis"), writes log and
// give up; a lost write is bounded by the 60s safety check in /next.

let blobMod;
async function mod() {
  if (!blobMod) blobMod = await import('@vercel/blob');
  return blobMod;
}

const token = () => process.env.BLOB_READ_WRITE_TOKEN || '';

export function signalsConfigured() {
  return !!token();
}

const flagPath = ownerId =>
  `queue-flag/${String(ownerId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;

// Public blob URLs are https://{storeId}.public.blob.vercel-storage.com/
// {path}; the store id is embedded in the token
// (vercel_blob_rw_{storeId}_{secret}). A put() refreshes the cached URL
// with the authoritative one from the SDK.
const urlCache = new Map(); // ownerId -> flag URL
function flagUrl(ownerId) {
  if (urlCache.has(ownerId)) return urlCache.get(ownerId);
  const m = /^vercel_blob_rw_([a-zA-Z0-9]+)_/.exec(token());
  if (!m) return null;
  return `https://${m[1]}.public.blob.vercel-storage.com/${flagPath(ownerId)}`;
}

// Last value written, per owner — skips writes that change nothing (e.g. a
// second job queued while the flag is already true).
const lastWritten = new Map();

// true (queue has work), false (verified empty), or null (unknown — caller
// must query Redis). A missing flag counts as unknown, not empty.
export async function readQueueSignal(ownerId) {
  const url = flagUrl(ownerId);
  if (!url) return null;
  try {
    // Cache-bust every read: plain URLs can serve ~2s stale from the CDN.
    const resp = await fetch(`${url}?cb=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null; // 404 = never written; else unknown
    const body = await resp.json();
    return typeof body.hasWork === 'boolean' ? body.hasWork : null;
  } catch {
    return null;
  }
}

export async function setQueueSignal(ownerId, hasWork) {
  if (!token()) return;
  if (lastWritten.get(ownerId) === hasWork) return;
  lastWritten.set(ownerId, hasWork);
  try {
    const { put } = await mod();
    const { url } = await put(flagPath(ownerId), JSON.stringify({ hasWork }), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: 'application/json',
    });
    urlCache.set(ownerId, url);
  } catch (err) {
    lastWritten.delete(ownerId); // retry on next state change
    console.warn(`[change-signal] flag write failed: ${err.message}`);
  }
}
