// lib/artifacts/blob.js — the hosted artifact store: Vercel Blob. Objects
// are public behind a random-suffix pathname (the unguessable suffix is
// the only access control); the pathname is the key. Requires
// BLOB_READ_WRITE_TOKEN (auto-set on Vercel).
//
// URLs are derived from the key, never stored for reading: the store id
// comes from the token (vercel_blob_rw_{storeId}_{secret}, the same
// derivation as lib/change-signal.js flagUrl). put compares the derived
// URL with the one Blob issues and logs loudly when they differ; readers
// then fall back to the *_url columns, which stay written until a later
// migration retires them.

let blobMod;
async function mod() {
  if (!blobMod) blobMod = await import('@vercel/blob');
  return blobMod;
}

const isUrl = ref => /^https?:\/\//i.test(ref);

// https://{storeId}.public.blob.vercel-storage.com, or null without a
// token. Lowercase: the token keeps the id's case, hostnames have none.
function origin() {
  const m = /^vercel_blob_rw_([a-zA-Z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN || '');
  return m ? `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

// A key's public URL. A legacy URL (rows from before keys) passes through.
function url(ref) {
  if (isUrl(ref)) return ref;
  const base = origin();
  return base ? `${base}/${ref.split('/').map(encodeURIComponent).join('/')}` : null;
}

// The key of a URL this store issued; null for any other host or a non-URL.
// The path is decoded, so an encoded slash (%2F..%2F) shows up as a '..'
// segment here: a key with an empty, '.' or '..' segment is refused, since
// url(key) would resolve it to some other object.
function keyFromUrl(u) {
  const base = origin();
  if (!base || typeof u !== 'string') return null;
  try {
    const parsed = new URL(u);
    if (parsed.hostname !== new URL(base).hostname) return null;
    const key = decodeURIComponent(parsed.pathname.slice(1));
    if (!key || key.split('/').some(s => s === '' || s === '.' || s === '..')) return null;
    return key;
  } catch {
    return null; // not a URL, or a malformed escape
  }
}

// addRandomSuffix keeps URLs unguessable even though access is 'public':
// the returned key, not the one asked for, is what the record stores.
async function put(key, body, contentType) {
  const { put: blobPut } = await mod();
  const res = await blobPut(key, body, { access: 'public', contentType, addRandomSuffix: true });
  const derived = url(res.pathname);
  if (!derived || new URL(derived).href !== new URL(res.url).href) {
    console.error(`[artifacts] url(key) mismatch: derived ${derived}, Blob issued ${res.url}`);
  }
  return { key: res.pathname, url: res.url };
}

// Artifacts never change after put, so a plain fetch (no cache-bust).
async function get(ref) {
  const u = url(ref);
  if (!u) throw new Error('blob store is not configured');
  const resp = await fetch(u);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`blob fetch failed (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

// @vercel/blob 0.27 deletes by URL, so keys map to theirs first.
async function del(refs) {
  const urls = [...new Set((refs || []).filter(Boolean).map(url).filter(Boolean))];
  if (!urls.length) return;
  try {
    const { del: blobDel } = await mod();
    await blobDel(urls);
  } catch {
    // Orphaned blobs cost pennies; never fail a queue operation over cleanup.
  }
}

/** @type {import('./index.js').ArtifactStore} */
export const blobStore = { driver: 'blob', inline: false, put, get, del, url, keyFromUrl };
