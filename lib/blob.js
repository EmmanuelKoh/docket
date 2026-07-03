// lib/blob.js — Vercel Blob helpers for heavy job artifacts (preview PNG and
// ESC/POS bytes). Job records in Redis hold blob URLs, never the payloads.
// Requires BLOB_READ_WRITE_TOKEN (auto-set on Vercel, manual for local use).

let blobMod;
async function mod() {
  if (!blobMod) blobMod = await import('@vercel/blob');
  return blobMod;
}

// Upload a buffer; returns the blob URL to store in the job record.
// addRandomSuffix keeps URLs unguessable even though access is 'public'.
export async function putBlob(pathname, buffer, contentType) {
  const { put } = await mod();
  const { url } = await put(pathname, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
  });
  return url;
}

export async function delBlobs(urls) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return;
  const { del } = await mod();
  try {
    await del(list);
  } catch {
    // Orphaned blobs cost pennies; never fail a queue operation over cleanup.
  }
}

export async function fetchBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`blob fetch failed (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}
