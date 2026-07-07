'use client';

// The live queue list. Server renders the initial data; this component
// then re-fetches /api/queue every 3 seconds WHILE THE TAB IS VISIBLE —
// the same visibility guard the legacy htmx fragment used, because hidden
// tabs polling forever is exactly the store-cost failure mode
// docs/store-costs.md exists to prevent. Job cards per spec: thumbnail,
// name + "source · created HH:MM:SS", status mono (printing = red),
// rail = "claimed Ns" for inflight or Cancel for queued only.

import { useCallback, useEffect, useState } from 'react';
import type { QueueJob } from '@/app/_lib/queue-data';
import { Button } from '@/components/ui/button';

const POLL_MS = 3000;

export function QueueList({ initial }: { initial: QueueJob[] }) {
  const [jobs, setJobs] = useState<QueueJob[]>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      // transient network error — keep the last good list
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function cancel(id: string) {
    try {
      const res = await fetch(
        `/api/jobs/cancel?job=${encodeURIComponent(id)}`,
        { method: 'POST' },
      );
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      // leave the list as is; the next poll corrects it
    }
  }

  if (!jobs.length) {
    return (
      <div className="rounded-md border-[0.5px] border-border bg-raised px-5 py-8 text-center text-sm text-ink-faint">
        No jobs waiting — print something from Templates
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-md border-[0.5px] border-border bg-raised px-5 py-4"
        >
          <div className="flex items-start gap-6">
            <div className="shrink-0 rounded-[2px] border-[0.5px] border-border bg-white">
              <img
                src={`/api/jobs/png?job=${encodeURIComponent(job.id)}`}
                alt=""
                loading="lazy"
                className="h-[108px] w-[158px] object-contain"
              />
            </div>
            <div className="min-w-0 grow pt-0.5">
              <div className="truncate font-mono text-[13px] text-ink">
                {job.name}
              </div>
              <div className="mt-0.5 text-xs text-ink-faint">
                {job.source} · created {job.createdTime}
              </div>
            </div>
            <span
              className={`pt-0.5 font-mono text-xs ${job.inflight ? 'text-red' : 'text-ink-muted'}`}
            >
              {job.statusText}
            </span>
            <div className="w-[118px] shrink-0 pt-0.5 text-right font-mono text-xs text-ink-faint">
              {job.inflight ? (
                <>claimed {job.claimedAgo}</>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto px-2.5 py-1 text-xs font-normal"
                  onClick={() => cancel(job.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
