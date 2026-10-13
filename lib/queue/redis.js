// lib/queue/redis.js — the hosted print queue in Upstash Redis, per owner:
//   rp:{owner}:jobs:queue     list of waiting ids, oldest at the head
//   rp:{owner}:jobs:inflight  sorted set: id -> lease expiry (ms)
//   rp:{owner}:jobs:seq       job id counter
//   rp:{owner}:jobs:attempts  hash: id -> failed print attempts (nacks);
//                             kept after the job ends, for History, and
//                             dropped when the record is trimmed
// The Blob queue flag (lib/change-signal.js) is maintained here so no
// caller can forget it: enqueue and requeue set it, an empty claim clears
// it, and hint reads it. Each write follows a fresh read of the flag, so
// it is skipped only when the flag already holds the value.
//
// COST RULE: an empty claim is exactly one EVAL and touches no Postgres
// (tests/meter-budget.test.ts counts it).

import { LEASE_SECONDS } from '../../config.js';
import { readQueueSignal, setQueueSignal } from '../change-signal.js';
import { getRedis, rkey } from '../redis.js';

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

const queueKey = ownerId => rkey(ownerId, 'jobs', 'queue');
const inflightKey = ownerId => rkey(ownerId, 'jobs', 'inflight');
const attemptsKey = ownerId => rkey(ownerId, 'jobs', 'attempts');

/** @type {import('./index.js').JobQueue} */
export const redisQueue = {
  driver: 'redis',

  async mintId(ownerId) {
    const redis = await getRedis();
    return `job-${await redis.incr(rkey(ownerId, 'jobs', 'seq'))}`;
  },

  async enqueue(ownerId, id) {
    const redis = await getRedis();
    await redis.rpush(queueKey(ownerId), id);
    await setQueueSignal(ownerId, true);
  },

  // The Blob flag: null without a Blob token (no fetch) or when unreadable.
  hint(ownerId) {
    return readQueueSignal(ownerId);
  },

  // seen: the flag as this request read it before claiming (undefined:
  // not read). It is what the flag writes below compare against.
  async claim(ownerId, seen) {
    const redis = await getRedis();
    const id = await redis.eval(
      CLAIM_LUA,
      [queueKey(ownerId), inflightKey(ownerId)],
      [Date.now(), LEASE_SECONDS * 1000],
    );
    if (!id) {
      // Verified-empty queue: clear the flag so idle polls skip Redis
      // until the next enqueue sets it again (no write if it already
      // says so).
      await setQueueSignal(ownerId, false, seen);
      return null;
    }
    // The flag said empty but a job was waiting (a lost or raced write):
    // set it, so every instance claims the rest instead of each waiting
    // for its own safety claim.
    if (seen === false) await setQueueSignal(ownerId, true, false);
    return id;
  },

  // Printed. Usually drops the lease; if the lease expired and the claim
  // script requeued the id before the ack arrived, drops that copy instead.
  async done(ownerId, id) {
    const redis = await getRedis();
    const held = await redis.zrem(inflightKey(ownerId), id);
    if (!held) await redis.lrem(queueKey(ownerId), 1, id);
  },

  // Back in line, once: at the front (LPUSH) or behind every job waiting
  // now (RPUSH). Without a lease the id may already wait (the claim script
  // requeues an expired lease at the front, or the job was never claimed),
  // so that copy moves; a zombie record (in neither structure) is put
  // back for real, or "Requeue" would only repaint the status.
  async requeue(ownerId, id, place = 'front') {
    const redis = await getRedis();
    const held = await redis.zrem(inflightKey(ownerId), id);
    if (!held) await redis.lrem(queueKey(ownerId), 0, id);
    await redis[place === 'back' ? 'rpush' : 'lpush'](queueKey(ownerId), id);
    await setQueueSignal(ownerId, true); // job is back in the queue
  },

  // LREM is atomic: if the claim script already popped the id, it removes
  // nothing. Then a lease means the printer may be receiving it; neither
  // means a zombie record nothing can ever print.
  async withdraw(ownerId, id) {
    const redis = await getRedis();
    if (await redis.lrem(queueKey(ownerId), 1, id)) return 'removed';
    const lease = await redis.zscore(inflightKey(ownerId), id);
    return lease !== null ? 'leased' : 'absent';
  },

  // Orphaned id (record trimmed): drop the claim.
  async drop(ownerId, id) {
    const redis = await getRedis();
    await redis.zrem(inflightKey(ownerId), id);
  },

  async countAttempt(ownerId, id) {
    const redis = await getRedis();
    return Number(await redis.hincrby(attemptsKey(ownerId), id, 1));
  },

  // One HGETALL: the hash holds only jobs that were nacked and whose
  // records still exist (forget drops trimmed ones).
  async attempts(ownerId) {
    const redis = await getRedis();
    const all = (await redis.hgetall(attemptsKey(ownerId))) || {};
    return Object.fromEntries(Object.entries(all).map(([id, n]) => [id, Number(n)]));
  },

  async forget(ownerId, ids) {
    if (!ids.length) return;
    const redis = await getRedis();
    await redis.hdel(attemptsKey(ownerId), ...ids);
  },

  // One LRANGE: the list is the order claims take. A requeue moves an id
  // rather than copying it, so each id appears once.
  async order(ownerId) {
    const redis = await getRedis();
    return ((await redis.lrange(queueKey(ownerId), 0, -1)) || []).map(String);
  },

  // Two commands, LLEN and ZCARD, and no Postgres. A lease that has
  // expired still counts as inflight until the next claim requeues it.
  async size(ownerId) {
    const redis = await getRedis();
    const [queued, inflight] = await Promise.all([
      redis.llen(queueKey(ownerId)),
      redis.zcard(inflightKey(ownerId)),
    ]);
    return { queued: Number(queued) || 0, inflight: Number(inflight) || 0 };
  },
};
