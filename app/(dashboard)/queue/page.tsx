// Queue (design spec: pages, Queue): what the printer holds and what
// waits, in print order, live (components/queue-list.tsx), as one deck.
// Not in the nav: the Printer page's Queue key links here, and Home's
// printer links here while jobs wait.
//
// Reads: the queue view (jobs.list of the live jobs, in the viewer's time
// zone) and slips.list once, to name each job's source ('sms' is "Text
// messages"). The poll re-reads only the queue view.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { queueData } from '@/app/_lib/queue-data';
import { jobSourceLabels, type SlipPair } from '@/app/_lib/slip-data';
import { viewerTimeZone } from '@/app/_lib/time';
import { QueueList } from '@/components/queue-list';
import { slipsList } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Queue' };

export default async function QueuePage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const tz = await viewerTimeZone();
  const [{ jobs }, pairs] = await Promise.all([
    queueData(caller, tz),
    slipsList(caller) as Promise<SlipPair[]>,
  ]);
  const labels = Object.fromEntries(jobSourceLabels(pairs));

  return <QueueList initial={jobs} labels={labels} />;
}
