// app/_lib/queue-data.ts — the queue view model. Shared by the Queue
// page (initial render), /api/queue (its poll) and the cancel and
// requeue routes, over jobs.list filtered to the live statuses, with
// failed attempts, in print order. Times are formatted in the viewer's
// time zone (pass viewerTimeZone() from app/_lib/time.ts). Also the
// queue's size for the panel's printer line, Home and Printer
// (jobs.queueSize), read once per request however many places show it.

import { cache } from 'react';
import type { Caller } from '@/lib/ops/caller.js';
import {
  jobsList,
  jobsOrder,
  jobsQueueSize,
  STUCK_AFTER_NACKS,
} from '@/lib/ops/jobs.js';
import { failedAttempts, type JobSummary, jobImageSrc } from './format';
import { agoLabel, clockLabel, dayLabel } from './time';

// Per request (React cache): the panel's printer line and the page share
// one read.
export const queueSize = cache((caller: Caller) => jobsQueueSize(caller));

export type QueueJob = {
  id: string;
  image: string; // the thumbnail's src (jobImageSrc)
  /** intrinsic size of the preview PNG, to reserve the thumbnail's space */
  width: number;
  height: number | null;
  name: string;
  /** the job's source id ('sms', 'studio'); '' when it has none */
  source: string;
  /** "17:30" today, else "Yesterday 17:30" or "Tue 13 Oct 17:30" */
  createdTime: string;
  attemptsText: string; // '' when none failed
  inflight: boolean;
  statusText: string;
  /** how long a printer has held it: "12 s"; '' when waiting */
  claimedAgo: string;
};

// A waiting job that keeps failing goes to the back (lib/job-store.js
// nackJob): behind every job queued before its last failure, ahead of
// any queued since.
const atBack = (j: JobSummary) =>
  j.status === 'queued' && (j.attempts ?? 0) >= STUCK_AFTER_NACKS;

function createdLabel(iso: string, timeZone: string, now: number): string {
  const day = dayLabel(iso, timeZone, now);
  const time = clockLabel(iso, timeZone);
  return day === 'Today' ? time : `${day} ${time}`;
}

function queueJobData(j: JobSummary, timeZone: string, now: number): QueueJob {
  return {
    id: j.id,
    image: jobImageSrc(j),
    width: j.width ?? 576,
    height: j.height ?? null,
    name: j.name || j.id,
    source: j.source || '',
    createdTime: createdLabel(j.createdAt, timeZone, now),
    attemptsText: failedAttempts(j.attempts),
    inflight: j.status === 'inflight',
    statusText: j.status === 'inflight' ? 'printing' : 'queued',
    claimedAgo:
      j.status === 'inflight' && j.claimedAt ? agoLabel(j.claimedAt, now) : '',
  };
}

export async function queueData(
  caller: Caller | null,
  timeZone = 'UTC',
): Promise<{
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
  const now = Date.now();
  return {
    jobs: [...printing, ...waiting].map((j) => queueJobData(j, timeZone, now)),
    count: live.length,
  };
}
