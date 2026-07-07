// app/_lib/queue-data.ts — the queue view model, ported from
// queueData()/queueJobData() in api/dashboard.js. Shared by the Queue
// page (initial render) and /api/queue (the 3-second poll).

import { listJobs } from '@/lib/job-store.js';
import { hhmmss, type JobSummary } from './format';

export type QueueJob = {
  id: string;
  name: string;
  source: string;
  createdTime: string;
  inflight: boolean;
  statusText: string;
  claimedAgo: string;
};

function queueJobData(j: JobSummary): QueueJob {
  return {
    id: j.id,
    name: j.name || j.id,
    source: j.source || '—',
    createdTime: hhmmss(j.createdAt),
    inflight: j.status === 'inflight',
    statusText: j.status === 'inflight' ? 'printing' : 'queued',
    claimedAgo: j.claimedAt
      ? `${Math.max(0, Math.floor((Date.now() - new Date(j.claimedAt).getTime()) / 1000))}s`
      : '',
  };
}

export async function queueData(): Promise<{
  jobs: QueueJob[];
  count: number;
}> {
  const jobs = (await listJobs(1000)) as JobSummary[];
  // Oldest first — top of the list is next to print.
  const live = jobs
    .filter((j) => j.status === 'queued' || j.status === 'inflight')
    .reverse();
  return { jobs: live.map(queueJobData), count: live.length };
}
