// Queue — title with "refreshes every 3s" subtitle, job count right
// (mono), then the live list (components/queue-list.tsx).

import { redirect } from 'next/navigation';
import { sessionOwner } from '@/app/_lib/dashboard-session';
import { queueData } from '@/app/_lib/queue-data';
import { QueueList } from '@/components/queue-list';

export default async function QueuePage() {
  const owner = await sessionOwner();
  if (!owner) redirect('/login');
  const { jobs, count } = await queueData(owner);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-medium text-ink">Queue</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Updates every 3 seconds.
          </p>
        </div>
        <span className="font-mono text-xs text-ink-muted">
          {count} job{count === 1 ? '' : 's'}
        </span>
      </div>
      <QueueList initial={jobs} />
    </div>
  );
}
