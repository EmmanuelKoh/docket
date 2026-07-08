// Jobs: Redis driver (Upstash) + Vercel Blob for heavy artifacts.
//
// Layout (all keys owner-namespaced via rkey):
//   rp:{owner}:jobs:seq       counter for job ids
//   rp:{owner}:jobs:queue     list of queued job ids (RPUSH create, LPOP claim)
//   rp:{owner}:jobs:inflight  zset of claimed ids, score = lease expiry (ms)
//   rp:{owner}:jobs:index     list of all job ids in creation order
//   rp:{owner}:job:{id}       job record; pngUrl/bytesUrl point at Vercel Blob
//
// Queue correctness:
//   - Claiming is one Lua eval, so two concurrent /next calls can never both
//     receive the same job.
//   - The same eval first requeues any inflight job whose lease expired, so a
//     printer that dies silently mid-job loses nothing — the job returns to
//     the front of the queue after LEASE_SECONDS.
//   - The queue/inflight structures are authoritative; the status field on
//     the record is informational for listing (an expired-lease job may read
//     'inflight' until it is reclaimed).

import { renderToEscpos } from '../../render/render-core.js';
import { JOB_CAP, LEASE_SECONDS, OWNER_ID } from '../../config.js';
import { getRedis, rkey } from '../redis.js';
import { putBlob, delBlobs, fetchBlob } from '../blob.js';
import { setQueueSignal } from '../change-signal.js';

const SEQ = rkey('jobs', 'seq');
const QUEUE = rkey('jobs', 'queue');
const INFLIGHT = rkey('jobs', 'inflight');
const INDEX = rkey('jobs', 'index');
const jobKey = id => rkey('job', id);

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

async function getRecord(redis, id) {
  const job = await redis.get(jobKey(id));
  return job && (!job.ownerId || job.ownerId === OWNER_ID) ? job : null;
}

// Delete oldest done/failed records (and their blobs) when over JOB_CAP.
// Mirrors the JSON driver: queued/inflight jobs are never trimmed.
async function trim(redis) {
  const ids = await redis.lrange(INDEX, 0, -1);
  let over = ids.length - JOB_CAP;
  if (over <= 0) return;
  const records = await redis.mget(...ids.map(jobKey));
  for (let i = 0; i < ids.length && over > 0; i++) {
    const job = records[i];
    if (job && job.status !== 'done' && job.status !== 'failed') continue;
    await redis.lrem(INDEX, 1, ids[i]);
    await redis.del(jobKey(ids[i]));
    if (job) await delBlobs([job.pngUrl, job.bytesUrl, job.dataUrl]);
    over--;
  }
}

// Render immediately, upload artifacts to Blob, store the record in Redis.
export async function createJob({ template, data, name, source }) {
  const { bytes, preview, width, height } = await renderToEscpos(template, data || {});
  const redis = await getRedis();
  const id = `job-${await redis.incr(SEQ)}`;

  const pngUrl = await putBlob(`jobs/${OWNER_ID}/${id}.png`, preview, 'image/png');
  const bytesUrl = await putBlob(`jobs/${OWNER_ID}/${id}.bin`, bytes, 'application/octet-stream');

  // Heavy inputs (e.g. a photo print's base64 image in data.photo) go to
  // Blob like the rendered outputs — a large data payload inlined in the
  // record would be re-downloaded by every dashboard list read (this once
  // cost 356MB of Redis bandwidth in a day). getJob() re-inflates it, so
  // the debug view and Reprint see the same record shape either way.
  const dataJson = JSON.stringify(data || {});
  let inlineData = data || {};
  let dataUrl = null;
  if (dataJson.length > 32 * 1024) {
    dataUrl = await putBlob(
      `jobs/${OWNER_ID}/${id}.data.json`, Buffer.from(dataJson), 'application/json');
    inlineData = null;
  }

  await redis.set(jobKey(id), {
    id,
    ownerId: OWNER_ID,
    createdAt: new Date().toISOString(),
    status: 'queued',
    name: name || '',
    source: source || '',
    template,
    data: inlineData,
    dataUrl,
    pngUrl,
    bytesUrl,
    width,
    height,
  });
  await redis.rpush(INDEX, id);
  await redis.rpush(QUEUE, id);
  // The queue flag lives here in the store layer so no feature code can
  // forget it: enqueue marks the queue as having work.
  await setQueueSignal(OWNER_ID, true);
  await trim(redis);
  return { id, status: 'queued', width, height };
}

// Store a job whose bytes were rendered by the caller (the Tape tool
// renders in the browser so its preview and its print are the same
// rows). Same record shape as createJob, but template/data are empty:
// there is nothing to re-render from.
export async function createRawJob({ name, source, bytes, png, width, height }) {
  const redis = await getRedis();
  const id = `job-${await redis.incr(SEQ)}`;

  const pngUrl = await putBlob(`jobs/${OWNER_ID}/${id}.png`, png, 'image/png');
  const bytesUrl = await putBlob(`jobs/${OWNER_ID}/${id}.bin`, bytes, 'application/octet-stream');

  await redis.set(jobKey(id), {
    id,
    ownerId: OWNER_ID,
    createdAt: new Date().toISOString(),
    status: 'queued',
    name: name || '',
    source: source || '',
    template: null,
    data: {},
    dataUrl: null,
    pngUrl,
    bytesUrl,
    width,
    height,
  });
  await redis.rpush(INDEX, id);
  await redis.rpush(QUEUE, id);
  await setQueueSignal(OWNER_ID, true);
  await trim(redis);
  return { id, status: 'queued', width, height };
}

// Atomically claim the oldest queued job. Returns { id, bytes } or null.
// If the blob fetch fails after the claim, the error propagates and the lease
// expiry returns the job to the queue — no print is lost.
export async function nextJob() {
  const redis = await getRedis();
  const id = await redis.eval(CLAIM_LUA, [QUEUE, INFLIGHT], [Date.now(), LEASE_SECONDS * 1000]);
  if (!id) {
    // Verified-empty queue: clear the flag so idle polls skip Redis until
    // the next enqueue sets it again.
    await setQueueSignal(OWNER_ID, false);
    return null;
  }

  const job = await getRecord(redis, id);
  if (!job) {
    // Orphaned id (record trimmed or foreign owner) — drop the claim.
    await redis.zrem(INFLIGHT, id);
    return null;
  }
  if (job.status !== 'inflight' || !job.claimedAt) {
    job.status = 'inflight';
    job.claimedAt = new Date().toISOString();
    await redis.set(jobKey(id), job);
  }
  const bytes = await fetchBlob(job.bytesUrl);
  return { id, bytes };
}

// Cancel a job — only while still queued. LREM is atomic: if the claim
// script already popped the id (printer has it), LREM returns 0 and we
// refuse. Canceled jobs keep their record and show up in History.
export async function cancelJob(id) {
  const redis = await getRedis();
  const job = await getRecord(redis, id);
  if (!job) return false;
  const removed = await redis.lrem(QUEUE, 1, id);
  if (!removed) return false;
  job.status = 'canceled';
  await redis.set(jobKey(id), job);
  return true;
}

// Mark done. Also removes the id from the queue in case its lease expired
// and it was requeued before the ack arrived.
export async function ackJob(id) {
  const redis = await getRedis();
  const job = await getRecord(redis, id);
  if (!job) return false;
  const held = await redis.zrem(INFLIGHT, id);
  if (!held) await redis.lrem(QUEUE, 1, id);
  job.status = 'done';
  await redis.set(jobKey(id), job);
  return true;
}

// Back to queued (retry, at the front). Only pushes if we actually held the
// lease — if it already expired, the claim script has requeued it for us.
export async function nackJob(id) {
  const redis = await getRedis();
  const job = await getRecord(redis, id);
  if (!job) return false;
  const held = await redis.zrem(INFLIGHT, id);
  if (held) await redis.lpush(QUEUE, id);
  job.status = 'queued';
  await redis.set(jobKey(id), job);
  await setQueueSignal(OWNER_ID, true); // job is back in the queue
  return true;
}

// Recent jobs, most-recent-first, without bulky fields.
export async function listJobs(limit = 20) {
  const redis = await getRedis();
  const ids = await redis.lrange(INDEX, -limit, -1);
  if (!ids.length) return [];
  const records = await redis.mget(...ids.map(jobKey));
  return records
    .filter(j => j && (!j.ownerId || j.ownerId === OWNER_ID))
    .reverse()
    .map(({ id, createdAt, status, width, height, name, source, claimedAt }) => ({
      id, createdAt, status, width, height, name, source, claimedAt,
    }));
}

// Full debug record for one job (inputs + metadata, no bulky payloads).
// Offloaded input data is re-inflated from Blob so the debug view and the
// Reprint action see the complete record regardless of where data lives.
export async function getJob(id) {
  const redis = await getRedis();
  const job = await getRecord(redis, id);
  if (!job) return null;
  const { pngUrl, bytesUrl, dataUrl, ...rest } = job;
  if (!rest.data && dataUrl) {
    try {
      rest.data = JSON.parse((await fetchBlob(dataUrl)).toString());
    } catch {
      rest.data = { _error: 'offloaded input data unavailable' };
    }
  }
  return rest;
}

// Return the stored preview PNG for a job (for thumbnails).
export async function getJobPng(id) {
  const redis = await getRedis();
  const job = await getRecord(redis, id);
  if (!job || !job.pngUrl) return null;
  return fetchBlob(job.pngUrl);
}
