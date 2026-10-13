// app/_lib/queue-data.ts — the queue view model. Shared by the Queue
// page (initial render) and /api/queue (its poll), over jobs.list
// filtered to the live statuses, with failed attempts, in print order.
// Also the queue's size for the sidebar badge and Overview
// (jobs.queueSize), read once per request however many places show it.

import { cache } from 'react';
import type { Caller } from '@/lib/ops/caller.js';
import {
  jobsList,
  jobsOrder,
  jobsQueueSize,
  STUCK_AFTER_NACKS,
} from '@/lib/ops/jobs.js';
import { failedAttempts, hhmmss, type JobSummary, jobImageSrc } from './format';

// Per request (React cache): the layout's badge and Overview's queue
// cell share one read.
export const queueSize = cache((caller: Caller) => jobsQueueSize(caller));

export type QueueJob = {
  id: string;
  image: string; // the thumbnail's src (jobImageSrc)
  name: string;
  source: string;
  createdTime: string;
  attemptsText: string; // '' when none failed
  inflight: boolean;
  statusText: string;
  claimedAgo: string;
};

// A waiting job that keeps failing goes to the back (lib/job-store.js
// nackJob): behind every job queued before its last failure, ahead of
// any queued since.
const atBack = (j: JobSummary) =>
  j.status === 'queued' && (j.attempts ?? 0) >= STUCK_AFTER_NACKS;

function queueJobData(j: JobSummary): QueueJob {
  return {
    id: j.id,
    image: jobImageSrc(j),
    name: j.name || j.id,
    source: j.source || '—',
    createdTime: hhmmss(j.createdAt),
    attemptsText: failedAttempts(j.attempts),
    inflight: j.status === 'inflight',
    statusText: j.status === 'inflight' ? 'printing' : 'queued',
    claimedAgo: j.claimedAt
      ? `${Math.max(0, Math.floor((Date.now() - new Date(j.claimedAt).getTime()) / 1000))}s`
      : '',
  };
}

export async function queueData(caller: Caller | null): Promise<{
  jobs: QueueJob[];
  count: number;
}> {
  const live: JobSummary[] = await jobsList(caller, {
    limit: 1000,
    status: ['queued', 'inflight'],
    attempts: true,
  });
  // Print order, top first: what printers hold now, then the waiting
  // jobs oldest first. A job at the back breaks creation order, and only
  // the queue knows where it went, so its order is read then (hosted, one
  // LRANGE); an ordinary poll reads nothing more. A queued record the
  // queue does not hold (nothing will print it) lists last.
  live.reverse();
  const printing = live.filter((j) => j.status === 'inflight');
  let waiting = live.filter((j) => j.status !== 'inflight');
  if (waiting.some(atBack)) {
    const { ids } = (await jobsOrder(caller)) as { ids: string[] };
    const place = new Map<string, number>();
    ids.forEach((id, i) => {
      if (!place.has(id)) place.set(id, i);
    });
    const at = (j: JobSummary) => place.get(j.id) ?? ids.length;
    waiting = [...waiting].sort((a, b) => at(a) - at(b));
  }
  return {
    jobs: [...printing, ...waiting].map(queueJobData),
    count: live.length,
  };
}
