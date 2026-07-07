// Probe: Vercel Blob read-after-write staleness for a small overwritten flag.
// Writes a tiny JSON file repeatedly and measures how long until a fresh
// fetch returns the new value — with and without a cache-busting query.
// Cleans up after itself.

import { put, del } from '@vercel/blob';

const PATH = 'probe/staleness-test-DELETE-ME.json';
const ROUNDS = 8;
const MAX_WAIT_MS = 20000;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN not set in env — cannot probe');
  process.exit(1);
}

async function fetchValue(url, bust) {
  const u = bust ? `${url}?cb=${Date.now()}-${Math.random()}` : url;
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) return null;
  try { return (await r.json()).v; } catch { return null; }
}

async function probe(bust) {
  const results = [];
  let url = null;
  for (let i = 0; i < ROUNDS; i++) {
    const v = `${Date.now()}-${i}`;
    const t0 = Date.now();
    const res = await put(PATH, JSON.stringify({ v }), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: 'application/json',
    });
    url = res.url;
    const tPut = Date.now() - t0;
    // poll until the new value is visible
    let seenAt = null;
    const tRead0 = Date.now();
    while (Date.now() - tRead0 < MAX_WAIT_MS) {
      if ((await fetchValue(url, bust)) === v) { seenAt = Date.now() - tRead0; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    results.push({ round: i, putMs: tPut, visibleAfterMs: seenAt ?? `>${MAX_WAIT_MS} STALE` });
  }
  return { url, results };
}

console.log('=== WITH cache-busting query (?cb=...) ===');
const busted = await probe(true);
for (const r of busted.results) console.log(r);

console.log('=== WITHOUT cache-busting (plain URL) ===');
const plain = await probe(false);
for (const r of plain.results) console.log(r);

// single-read latency sample
const t0 = Date.now();
await fetchValue(busted.url, true);
console.log('one cache-busted read latency:', Date.now() - t0, 'ms');

await del(busted.url);
console.log('cleaned up probe blob');
