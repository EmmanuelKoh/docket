// lib/queue/index.js: the print queue by concern: ids waiting per owner, a
// lease while a printer holds one, and the cheap "anything waiting?" hint.
// Job records (status, artifact refs) stay in Postgres via lib/job-store.js.
// The queue also counts failed print attempts (nacks) per job, which
// decide where a nacked job waits (lib/job-store.js nackJob).
/**
 * @typedef {'removed' | 'leased' | 'absent'} Withdrawn
 * @typedef {'front' | 'back'} Place
 * @typedef {object} JobQueue
 * @property {'redis' | 'postgres'} driver
 * @property {(ownerId: string) => Promise<string>} mintId                     next 'job-N'
 * @property {(ownerId: string, id: string) => Promise<void>} enqueue          after the row insert
 * @property {(ownerId: string) => Promise<boolean | null>} hint               false = verified empty; null = unknown
 * @property {(ownerId: string, seen?: boolean | null) => Promise<string | null>} claim
 *           lease the oldest waiting id; null = empty. seen = what hint just said, so the driver can correct it
 * @property {(ownerId: string, id: string) => Promise<void>} done             printed: drop the lease or a requeued copy
 * @property {(ownerId: string, id: string, place?: Place) => Promise<void>} requeue  back in line: front (default) or back
 * @property {(ownerId: string, id: string) => Promise<Withdrawn>} withdraw    cancel attempt
 * @property {(ownerId: string, id: string) => Promise<void>} drop             forget an id whose record is gone
 * @property {(ownerId: string, id: string) => Promise<number>} countAttempt   one more failed attempt; returns the count
 * @property {(ownerId: string) => Promise<Record<string, number>>} attempts   failed attempts per id (ids with none left out)
 * @property {(ownerId: string, ids: string[]) => Promise<void>} forget        records trimmed: drop their attempt counts
 * @property {(ownerId: string) => Promise<{ queued: number, inflight: number }>} size
 *           ids waiting and ids leased, for the sidebar badge and Overview (no job records read hosted)
 * @property {(ownerId: string) => Promise<string[]>} order                    ids waiting, in the order they will be claimed
 */
import { STORE_DRIVER } from '../../config.js';

// Derived, not configured: add an override when a third driver exists.
export const QUEUE_DRIVER = STORE_DRIVER === 'redis' ? 'redis' : 'postgres';
/** @type {JobQueue | undefined} */
let queue;
/** @returns {Promise<JobQueue>} */
export async function getQueue() {
  queue ??= QUEUE_DRIVER === 'redis'
    ? (await import('./redis.js')).redisQueue
    : (await import('./postgres.js')).postgresQueue;
  return queue;
}
