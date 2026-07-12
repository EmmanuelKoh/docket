// lib/job-store.js — job storage + print queue.
// Render-on-create: createJob renders immediately and stores the finished
// bytes. Polling (/next) returns stored bytes; it does not render.
//
// Phase 4 split: the job RECORD (metadata + debug inputs) lives in
// Postgres (the job table, system of record); what varies by
// STORE_DRIVER is the queue and the heavy artifacts —
//   redis — the queue/lease stay in Upstash (atomic Lua claim + lease
//           expiry, unchanged), artifacts (png, ESC/POS bytes, offloaded
//           inputs) in Vercel Blob
//   json  — local dev: no queue service; claiming is a plain Postgres
//           update (no lease — same semantics the old json driver had),
//           artifacts inline base64 in the row (PGlite is local disk)
//
// COST RULE: the empty-poll path (/next every 3s after the Blob flag
// says "maybe work") must never touch Postgres when hosted. The claim
// runs entirely in Redis; only an actual claimed job — a real print —
// reads and updates the Postgres row.

import { and, asc, desc, eq } from 'drizzle-orm';
import { JOB_CAP, LEASE_SECONDS, STORE_DRIVER } from '../config.js';
import { job } from '../db/schema.js';
import { renderToEscpos } from '../render/render-core.js';
import { setQueueSignal } from './change-signal.js';
import { getDb } from './db.js';

const HOSTED = STORE_DRIVER === 'redis';

// KEYS[1]=queue KEYS[2]=inflight ARGV[1]=now(ms) ARGV[2]=lease(ms)
// Requeue expired leases at the front, then atomically claim the next id.
const CLAIM_LUA = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
for i = 1, #expired do
  redis.call('ZREM', KEYS[2], expired[i])
  redis.call('LPUSH', KEYS[1], expired[i])
end
local id = redis.call('LPOP', KEYS[1])
if not id then return nil end
redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[2]), id)
return id
`;

async function redisAnd(fn) {
  const { getRedis, rkey } = await import('./redis.js');
  const redis = await getRedis();
  return fn(redis, rkey);
}

const iso = d => (d?.toISOString ? d.toISOString() : d);
const summary = r => ({
  id: r.id,
  createdAt: iso(r.createdAt),
  status: r.status,
  width: r.width,
  height: r.height,
  name: r.name,
  source: r.source,
  claimedAt: iso(r.claimedAt),
});

async function rowFor(db, ownerId, id) {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .limit(1);
  return rows[0] || null;
}

async function setStatus(db, ownerId, id, set) {
  const updated = await db
    .update(job)
    .set(set)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .returning({ id: job.id });
  return updated.length > 0;
}

async function mintId(db, ownerId) {
  if (HOSTED) {
    return redisAnd(async (redis, rkey) => `job-${await redis.incr(rkey(ownerId, 'jobs', 'seq'))}`);
  }
  const rows = await db.select({ id: job.id }).from(job).where(eq(job.ownerId, ownerId));
  let max = 0;
  for (const r of rows) {
    const m = r.id.match(/^job-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `job-${max + 1}`;
}

// Delete oldest done/failed records (and their blobs) when over JOB_CAP.
// Queued/inflight jobs are never trimmed.
async function trim(db, ownerId) {
  const rows = await db
    .select({ id: job.id, status: job.status, pngUrl: job.pngUrl, bytesUrl: job.bytesUrl, dataUrl: job.dataUrl })
    .from(job)
    .where(eq(job.ownerId, ownerId))
    .orderBy(asc(job.createdAt));
  let over = rows.length - JOB_CAP;
  for (const r of rows) {
    if (over <= 0) break;
    if (r.status !== 'done' && r.status !== 'failed') continue;
    await db.delete(job).where(and(eq(job.ownerId, ownerId), eq(job.id, r.id)));
    const urls = [r.pngUrl, r.bytesUrl, r.dataUrl].filter(Boolean);
    if (urls.length) {
      const { delBlobs } = await import('./blob.js');
      await delBlobs(urls);
    }
    over--;
  }
}

// Store a rendered job: artifacts by driver, record in Postgres, id into
// the queue. Shared by createJob (renders) and createRawJob (caller did).
async function storeJob(ownerId, { bytes, preview, width, height, template, data, name, source }) {
  const db = await getDb();
  const id = await mintId(db, ownerId);
  const row = {
    ownerId,
    id,
    status: 'queued',
    name: name || '',
    source: source || '',
    template: template ?? null,
    data: data ?? {},
    dataUrl: null,
    pngUrl: null,
    bytesUrl: null,
    png: null,
    bytes: null,
    width,
    height,
  };

  if (HOSTED) {
    const { putBlob } = await import('./blob.js');
    row.pngUrl = await putBlob(`jobs/${ownerId}/${id}.png`, preview, 'image/png');
    row.bytesUrl = await putBlob(`jobs/${ownerId}/${id}.bin`, bytes, 'application/octet-stream');
    // Heavy inputs (e.g. a photo print's base64 image in data.photo) go
    // to Blob like the rendered outputs — a large payload inlined in the
    // record would bloat every list read (this once cost 356MB of store
    // bandwidth in a day). getJob() re-inflates it.
    const dataJson = JSON.stringify(data || {});
    if (dataJson.length > 32 * 1024) {
      row.dataUrl = await putBlob(
        `jobs/${ownerId}/${id}.data.json`,
        Buffer.from(dataJson),
        'application/json',
      );
      row.data = null;
    }
  } else {
    row.png = preview.toString('base64');
    row.bytes = bytes.toString('base64');
  }

  await db.insert(job).values(row);

  if (HOSTED) {
    await redisAnd(async (redis, rkey) => {
      await redis.rpush(rkey(ownerId, 'jobs', 'queue'), id);
    });
    // The queue flag lives here in the store layer so no feature code can
    // forget it: enqueue marks the queue as having work.
    await setQueueSignal(ownerId, true);
  }
  await trim(db, ownerId);
  return { id, status: 'queued', width, height };
}

// Render immediately, then store.
export async function createJob(ownerId, { template, data, name, source }) {
  const rendered = await renderToEscpos(template, data || {});
  return storeJob(ownerId, { ...rendered, template, data, name, source });
}

// Store a job whose bytes were rendered by the caller (the Tape tool
// renders in the browser so its preview and its print are the same
// rows). template/data are empty: there is nothing to re-render from.
export async function createRawJob(ownerId, { name, source, bytes, png, width, height }) {
  return storeJob(ownerId, {
    bytes,
    preview: png,
    width,
    height,
    template: null,
    data: {},
    name,
    source,
  });
}

// Atomically claim the oldest queued job. Returns { id, bytes } or null.
// Hosted: the claim is one Redis Lua eval; an EMPTY queue returns before
// any Postgres access (the 3-second polling path). If the artifact fetch
// fails after the claim, the error propagates and the lease expiry
// returns the job to the queue — no print is lost.
export async function nextJob(ownerId) {
  const db = await getDb();

  if (HOSTED) {
    const id = await redisAnd((redis, rkey) =>
      redis.eval(
        CLAIM_LUA,
        [rkey(ownerId, 'jobs', 'queue'), rkey(ownerId, 'jobs', 'inflight')],
        [Date.now(), LEASE_SECONDS * 1000],
      ),
    );
    if (!id) {
      // Verified-empty queue: clear the flag so idle polls skip Redis
      // until the next enqueue sets it again.
      await setQueueSignal(ownerId, false);
      return null;
    }
    const row = await rowFor(db, ownerId, id);
    if (!row) {
      // Orphaned id (record trimmed) — drop the claim.
      await redisAnd((redis, rkey) => redis.zrem(rkey(ownerId, 'jobs', 'inflight'), id));
      return null;
    }
    if (row.status !== 'inflight' || !row.claimedAt) {
      await setStatus(db, ownerId, id, { status: 'inflight', claimedAt: new Date() });
    }
    const { fetchBlob } = await import('./blob.js');
    return { id, bytes: await fetchBlob(row.bytesUrl) };
  }

  // Local: plain Postgres claim, no lease (single-process dev).
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.status, 'queued')))
    .orderBy(asc(job.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await setStatus(db, ownerId, row.id, { status: 'inflight', claimedAt: new Date() });
  return { id: row.id, bytes: Buffer.from(row.bytes, 'base64') };
}

// Cancel a job — only while still queued (never yank an inflight job the
// printer may already be receiving). Hosted, LREM is atomic: if the claim
// script already popped the id, LREM returns 0 and we refuse. Canceled
// jobs keep their record and show up in History.
export async function cancelJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return false;
  if (HOSTED) {
    const removed = await redisAnd((redis, rkey) =>
      redis.lrem(rkey(ownerId, 'jobs', 'queue'), 1, id),
    );
    if (!removed) return false;
  } else if (row.status !== 'queued') {
    return false;
  }
  return setStatus(db, ownerId, id, { status: 'canceled' });
}

// Mark done. Hosted, also removes the id from the queue in case its lease
// expired and it was requeued before the ack arrived.
export async function ackJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return false;
  if (HOSTED) {
    await redisAnd(async (redis, rkey) => {
      const held = await redis.zrem(rkey(ownerId, 'jobs', 'inflight'), id);
      if (!held) await redis.lrem(rkey(ownerId, 'jobs', 'queue'), 1, id);
    });
  }
  return setStatus(db, ownerId, id, { status: 'done' });
}

// Back to queued (retry, at the front). Hosted, only pushes if we
// actually held the lease — if it already expired, the claim script has
// requeued it for us.
export async function nackJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return false;
  if (HOSTED) {
    await redisAnd(async (redis, rkey) => {
      const held = await redis.zrem(rkey(ownerId, 'jobs', 'inflight'), id);
      if (held) await redis.lpush(rkey(ownerId, 'jobs', 'queue'), id);
    });
    await setQueueSignal(ownerId, true); // job is back in the queue
  }
  return setStatus(db, ownerId, id, { status: 'queued' });
}

// Recent jobs, most-recent-first, without bulky fields.
export async function listJobs(ownerId, limit = 20) {
  const db = await getDb();
  const rows = await db
    .select({
      id: job.id,
      createdAt: job.createdAt,
      status: job.status,
      width: job.width,
      height: job.height,
      name: job.name,
      source: job.source,
      claimedAt: job.claimedAt,
    })
    .from(job)
    .where(eq(job.ownerId, ownerId))
    .orderBy(desc(job.createdAt))
    .limit(limit);
  return rows.map(summary);
}

// Full debug record for one job (inputs + metadata, no bulky payloads).
// Offloaded input data is re-inflated from Blob so the debug view and the
// Reprint action see the complete record regardless of where data lives.
export async function getJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return null;
  const { png, bytes, pngUrl, bytesUrl, dataUrl, createdAt, claimedAt, ...rest } = row;
  const record = { ...rest, createdAt: iso(createdAt), claimedAt: iso(claimedAt) };
  if (!record.data && dataUrl) {
    try {
      const { fetchBlob } = await import('./blob.js');
      record.data = JSON.parse((await fetchBlob(dataUrl)).toString());
    } catch {
      record.data = { _error: 'offloaded input data unavailable' };
    }
  }
  return record;
}

// Return the stored preview PNG for a job (for thumbnails).
export async function getJobPng(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return null;
  if (row.pngUrl) {
    const { fetchBlob } = await import('./blob.js');
    return fetchBlob(row.pngUrl);
  }
  if (row.png) return Buffer.from(row.png, 'base64');
  return null;
}
