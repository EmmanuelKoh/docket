// lib/job-store.js — job storage + print queue.
// Render-on-create: createJob renders immediately and stores the finished
// bytes. Polling (/next) returns stored bytes; it does not render. The
// renderer is imported inside createJob, so /next, /ack and raw (Tape)
// jobs never load it (tests/lazy-render.test.ts).
//
// Phase 4 split: the job RECORD (metadata + debug inputs) lives in
// Postgres (the job table, system of record). This file composes it with
// the queue (lib/queue/: ids waiting, the lease, the "anything waiting?"
// hint) and the heavy artifacts (lib/artifacts/), both chosen by
// STORE_DRIVER —
//   redis — artifacts (png, ESC/POS bytes, offloaded inputs) in Vercel
//           Blob, recorded by key; the queue is the Redis driver (atomic
//           Lua claim + lease expiry)
//   json  — local dev: artifacts inline base64 in the row (PGlite is local
//           disk); the queue is the Postgres driver (status 'queued' rows,
//           no lease expiry)
// Rows from before keys hold only *_url; readers try the key, then the URL.
//
// COST RULE: the empty-poll path (/next every 5s after the Blob flag
// says "maybe work") must never touch Postgres when hosted. The claim
// runs entirely in the queue; only an actual claimed job — a real print —
// reads and updates the Postgres row.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { JOB_CAP } from '../config.js';
import { job } from '../db/schema.js';
import { getArtifacts, readFirst } from './artifacts/index.js';
import { getDb } from './db.js';
import { getQueue } from './queue/index.js';

const iso = d => (d?.toISOString ? d.toISOString() : d);
// Rows created in the same millisecond (PGlite's now() has ms resolution)
// fall back to the job sequence: job-9 before job-10, as the local
// queue's claim orders them.
const OLDEST_FIRST = [asc(job.createdAt), sql`length(${job.id})`, asc(job.id)];
const NEWEST_FIRST = [desc(job.createdAt), sql`length(${job.id}) desc`, desc(job.id)];
// Statuses a printer may still print: anything else is finished.
const LIVE = ['queued', 'inflight'];
// From this many failed attempts (nacks) on, a nacked job waits at the
// back of its owner's queue instead of the front, so the jobs behind it
// print. Nothing marks a job failed on its own: the firmware also nacks on
// paper-out, which a refill fixes.
export const STUCK_AFTER_NACKS = 3;
// imageUrl: the preview PNG's public URL when the artifact store serves
// one (Blob), so the dashboard loads it straight from the store; null
// locally (inline rows), where /api/jobs/png serves it.
const summary = (r, store) => ({
  id: r.id,
  createdAt: iso(r.createdAt),
  status: r.status,
  width: r.width,
  height: r.height,
  name: r.name,
  source: r.source,
  claimedAt: iso(r.claimedAt),
  kind: r.kind,
  hasTemplate: r.hasTemplate,
  imageUrl: imageUrlOf(r, store),
});

// The browser cannot fall back from one URL to another the way
// readArtifact does, so the URL Blob issued at put comes first (while
// *_url is still written, until a later migration retires the *_url
// columns), then the key's. A row with neither (an inline row in a shared
// database) gets null.
function imageUrlOf(r, store) {
  if (store.inline) return null;
  const ref = r.pngUrl || r.pngKey;
  return ref ? store.url(ref) : null;
}

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

// The stored artifact: inline in the row (local), else from the store by
// key, falling back to the legacy URL when the key read finds nothing or
// fails (rows from before keys, or a key whose derived URL is wrong while
// *_url is still written). f is 'png', 'bytes' or 'data'; data is jsonb,
// so callers read it here only when the row's data was offloaded (null).
async function readArtifact(row, f) {
  if (row[f]) return Buffer.from(row[f], 'base64'); // inline (local)
  const buf = await readFirst([row[`${f}Key`], row[`${f}Url`]]);
  if (!buf) throw new Error(`job ${row.id}: ${f} missing`); // /next: lease expiry requeues
  return buf;
}

// Delete oldest done/failed records (and their artifacts) when over
// JOB_CAP. Queued/inflight jobs are never trimmed.
async function trim(db, ownerId) {
  const rows = await db
    .select({
      id: job.id,
      status: job.status,
      pngKey: job.pngKey,
      bytesKey: job.bytesKey,
      dataKey: job.dataKey,
      pngUrl: job.pngUrl,
      bytesUrl: job.bytesUrl,
      dataUrl: job.dataUrl,
    })
    .from(job)
    .where(eq(job.ownerId, ownerId))
    .orderBy(...OLDEST_FIRST);
  let over = rows.length - JOB_CAP;
  const gone = [];
  for (const r of rows) {
    if (over <= 0) break;
    if (r.status !== 'done' && r.status !== 'failed') continue;
    await db.delete(job).where(and(eq(job.ownerId, ownerId), eq(job.id, r.id)));
    // One ref per artifact: its key, or the URL on rows from before keys.
    const refs = [r.pngKey || r.pngUrl, r.bytesKey || r.bytesUrl, r.dataKey || r.dataUrl].filter(Boolean);
    if (refs.length) await (await getArtifacts()).del(refs);
    gone.push(r.id);
    over--;
  }
  if (gone.length) await (await getQueue()).forget(ownerId, gone); // their attempt counts
}

// Store a rendered job: artifacts by driver, record in Postgres, id into
// the queue. Shared by createJob (renders) and createRawJob (caller did).
// kind says whether the job can be re-rendered ('template') or not
// ('raw'); encoding records the framing the bytes use (null if unknown).
async function storeJob(ownerId, { kind, encoding, bytes, preview, width, height, template, data, name, source }) {
  const db = await getDb();
  const queue = await getQueue();
  const id = await queue.mintId(ownerId);
  const row = {
    ownerId,
    id,
    status: 'queued',
    name: name || '',
    source: source || '',
    kind,
    encoding: encoding ?? null,
    template: template ?? null,
    data: data ?? {},
    dataKey: null,
    pngKey: null,
    bytesKey: null,
    dataUrl: null,
    pngUrl: null,
    bytesUrl: null,
    png: null,
    bytes: null,
    width,
    height,
  };

  const store = await getArtifacts();
  if (store.inline) {
    row.png = preview.toString('base64');
    row.bytes = bytes.toString('base64');
  } else {
    // Readers use the keys; *_url is still written so code from before
    // keys (a rollback) keeps reading these rows, until a later migration
    // retires the *_url columns.
    const png = await store.put(`jobs/${ownerId}/${id}.png`, preview, 'image/png');
    const bin = await store.put(`jobs/${ownerId}/${id}.bin`, bytes, 'application/octet-stream');
    Object.assign(row, { pngKey: png.key, pngUrl: png.url, bytesKey: bin.key, bytesUrl: bin.url });
    // Heavy inputs (e.g. a photo print's base64 image in data.photo) go
    // to the store like the rendered outputs — a large payload inlined in
    // the record would bloat every list read (this once cost 356MB of
    // store bandwidth in a day). getJob() re-inflates it.
    const dataJson = JSON.stringify(data || {});
    if (dataJson.length > 32 * 1024) {
      const d = await store.put(`jobs/${ownerId}/${id}.data.json`, Buffer.from(dataJson), 'application/json');
      Object.assign(row, { dataKey: d.key, dataUrl: d.url, data: null });
    }
  }

  await db.insert(job).values(row);
  // Hosted, enqueue also sets the queue flag, so no feature code can
  // forget it.
  await queue.enqueue(ownerId, id);
  await trim(db, ownerId);
  return { id, status: 'queued', width, height };
}

// Render immediately, then store. render-core reports the encoding. It is
// imported here, not at the top, so the device paths never load it.
export async function createJob(ownerId, { template, data, name, source }) {
  const { renderToEscpos } = await import('../render/render-core.js');
  const rendered = await renderToEscpos(template, data || {});
  return storeJob(ownerId, { ...rendered, kind: 'template', template, data, name, source });
}

// Store a job whose bytes were rendered by the caller (the Tape tool
// renders in the browser so its preview and its print are the same
// rows). template/data are empty: there is nothing to re-render from.
// encoding is the caller's JobEncoding, when it knows its framing.
/**
 * @param {string} ownerId
 * @param {{ name: string, source: string, bytes: Buffer, png: Buffer, width: number, height: number,
 *   encoding?: import('../db/schema.js').JobEncoding | null }} job
 */
export async function createRawJob(ownerId, { name, source, bytes, png, width, height, encoding = null }) {
  return storeJob(ownerId, {
    kind: 'raw',
    encoding,
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

// The queue's cheap hint for /next: true = the flag says work, false =
// verified empty (skip the claim), null = unknown or no flag (claim).
// Reads at most the Blob flag; never Redis or Postgres.
export async function peekQueue(ownerId) {
  return (await getQueue()).hint(ownerId);
}

// How many jobs wait and how many a printer holds, from the queue alone:
// hosted, two Redis commands and no Postgres (the sidebar badge renders
// on every dashboard page load).
export async function queueSize(ownerId) {
  return (await getQueue()).size(ownerId);
}

// The ids waiting to print, next first, from the queue alone (hosted: one
// LRANGE, no Postgres). The Queue page reads it only while a job waits at
// the back, the one case where print order is not creation order.
export async function queueOrder(ownerId) {
  return (await getQueue()).order(ownerId);
}

// Atomically claim the oldest queued job. Returns { id, bytes } or null.
// Hosted: the claim is one Redis Lua eval; an EMPTY queue returns before
// any Postgres access (the 5-second polling path). If the artifact fetch
// fails after the claim, the error propagates and the lease expiry
// returns the job to the queue — no print is lost. seen is what
// peekQueue just said, if the caller read it: the queue corrects the
// flag from it.
/** @param {string} ownerId @param {boolean | null} [seen] */
export async function nextJob(ownerId, seen) {
  const queue = await getQueue();
  const id = await queue.claim(ownerId, seen); // empty: 1 EVAL hosted, no Postgres
  if (!id) return null;
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row || !LIVE.includes(row.status)) {
    // Orphaned id (record trimmed), or a finished job a requeue raced an
    // ack to push back: drop the claim, never print it again.
    await queue.drop(ownerId, id);
    return null;
  }
  if (row.status !== 'inflight' || !row.claimedAt) {
    await setStatus(db, ownerId, id, { status: 'inflight', claimedAt: new Date() });
  }
  return { id, bytes: await readArtifact(row, 'bytes') };
}

// Cancel a job — only while still queued (never yank an inflight job the
// printer may already be receiving). The queue's withdraw is atomic
// hosted: if the claim script already popped the id, it reports the lease
// and we refuse. An id in neither queue structure is a zombie record
// (status says queued but nothing can ever print it); cancel is exactly
// the cleanup for that. Canceled jobs keep their record and show up in
// History.
export async function cancelJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row || !LIVE.includes(row.status)) return false;
  if ((await (await getQueue()).withdraw(ownerId, id)) === 'leased') return false;
  return setStatus(db, ownerId, id, { status: 'canceled' });
}

// Mark done. The queue drops the lease, or the requeued copy if the lease
// expired before the ack arrived.
export async function ackJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return false;
  await (await getQueue()).done(ownerId, id);
  return setStatus(db, ownerId, id, { status: 'done' });
}

// A printer could not print it: count the attempt, then back to queued,
// at the front to retry at once, or at the back from the
// STUCK_AFTER_NACKS-th attempt on.
export async function nackJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return false;
  const queue = await getQueue();
  const attempts = await queue.countAttempt(ownerId, id);
  await queue.requeue(ownerId, id, attempts >= STUCK_AFTER_NACKS ? 'back' : 'front');
  return setStatus(db, ownerId, id, { status: 'queued' });
}

// The dashboard's Requeue: back to the front, only while queued or
// printing. The status write goes first and only matches a live job, so
// an ack that already marked the job done refuses the requeue. An ack
// that lands after it still ends at done, and nextJob drops the id this
// pushed. Returns { requeued, status }: status is what refused it, null
// for no such job.
export async function requeueJob(ownerId, id) {
  const db = await getDb();
  const updated = await db
    .update(job)
    .set({ status: 'queued' })
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id), inArray(job.status, LIVE)))
    .returning({ id: job.id });
  if (updated.length) {
    await (await getQueue()).requeue(ownerId, id);
    return { requeued: true, status: 'queued' };
  }
  const row = await rowFor(db, ownerId, id);
  return { requeued: false, status: row?.status ?? null };
}

// Recent jobs, most-recent-first (ties by job sequence), without bulky fields. hasTemplate is
// computed in SQL so the template text never leaves the database; the
// preview PNG is a URL (imageUrl, hosted), never its bytes. status,
// when given, keeps only jobs in those statuses. attempts adds each job's
// failed print attempts from the queue: one read, made only when a listed
// job was ever handed to a printer (claimedAt), the only way to have any.
/**
 * @param {string} ownerId
 * @param {number} [limit]
 * @param {{ status?: string[], attempts?: boolean }} [filter]
 */
export async function listJobs(ownerId, limit = 20, { status, attempts = false } = {}) {
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
      kind: job.kind,
      hasTemplate: sql`${job.template} is not null`,
      pngKey: job.pngKey,
      pngUrl: job.pngUrl,
    })
    .from(job)
    .where(status ? and(eq(job.ownerId, ownerId), inArray(job.status, status)) : eq(job.ownerId, ownerId))
    .orderBy(...NEWEST_FIRST)
    .limit(limit);
  const store = await getArtifacts();
  const jobs = rows.map(r => summary(r, store));
  if (attempts) {
    const counts = rows.some(r => r.claimedAt) ? await (await getQueue()).attempts(ownerId) : {};
    for (const j of jobs) j.attempts = counts[j.id] || 0;
  }
  return jobs;
}

// Full debug record for one job (inputs + metadata, kind and encoding
// included; no bulky payloads or artifact locations).
// Offloaded input data is re-inflated from the artifact store so the debug
// view and the Reprint action see the complete record regardless of where
// data lives.
export async function getJob(ownerId, id) {
  const db = await getDb();
  const row = await rowFor(db, ownerId, id);
  if (!row) return null;
  const { png, bytes, pngUrl, bytesUrl, dataUrl, pngKey, bytesKey, dataKey, createdAt, claimedAt, ...rest } = row;
  const record = { ...rest, createdAt: iso(createdAt), claimedAt: iso(claimedAt) };
  if (!record.data && (dataKey || dataUrl)) {
    try {
      record.data = JSON.parse((await readArtifact(row, 'data')).toString());
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
  if (!row || !(row.png || row.pngKey || row.pngUrl)) return null;
  return readArtifact(row, 'png');
}
