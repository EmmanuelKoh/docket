'use client';

// The live queue list. Server renders the initial data; this component
// then re-fetches /api/queue while the tab is visible, at a cadence that
// follows the human: every 3s while they are active on the page, easing
// to 30s after two idle minutes, and stopping entirely after thirty —
// each poll is a function invocation and a Postgres read, and a tab
// parked on a second monitor must not bill around the clock
// (docs/store-costs.md). Any interaction resumes the fast cadence; the
// quiet "refresh" control re-fetches on demand and doubles as the resume
// affordance while paused. Job cards per spec: thumbnail, name +
// "source · created HH:MM:SS", status mono (printing = red), rail =
// "claimed Ns" for inflight or Cancel for queued only.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueJob } from '@/app/_lib/queue-data';

const POLL_MS = 3000;
const EASE_AFTER_MS = 2 * 60 * 1000;
const EASE_POLL_MS = 30_000;
const PAUSE_AFTER_MS = 30 * 60 * 1000;

type PollMode = 'live' | 'eased' | 'paused';

export function QueueList({ initial }: { initial: QueueJob[] }) {
  const [jobs, setJobs] = useState<QueueJob[]>(initial);
  const [mode, setMode] = useState<PollMode>('live');
  const lastActivity = useRef(Date.now());
  const lastFetch = useRef(Date.now());

  const refresh = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      // transient network error — keep the last good list
    }
  }, []);

  const manualRefresh = useCallback(() => {
    lastActivity.current = Date.now();
    setMode('live');
    refresh();
  }, [refresh]);

  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    document.addEventListener('visibilitychange', bump);

    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const idle = Date.now() - lastActivity.current;
      if (idle > PAUSE_AFTER_MS) {
        setMode('paused');
        return;
      }
      const eased = idle > EASE_AFTER_MS;
      setMode(eased ? 'eased' : 'live');
      const cadence = eased ? EASE_POLL_MS : POLL_MS;
      if (Date.now() - lastFetch.current >= cadence - 100) refresh();
    }, POLL_MS);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      document.removeEventListener('visibilitychange', bump);
    };
  }, [refresh]);

  // cancel a queued job; requeue an inflight one (a stuck claim back to
  // queued). Both return the fresh list so the row updates in one round trip.
  async function act(path: string, id: string) {
    try {
      const res = await fetch(`${path}?job=${encodeURIComponent(id)}`, {
        method: 'POST',
      });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      // leave the list as is; the next poll corrects it
    }
  }
  const cancel = (id: string) => act('/api/jobs/cancel', id);
  const requeue = (id: string) => act('/api/jobs/requeue', id);

  const statusLine = (
    <div className="flex items-baseline justify-end gap-2 text-xs text-ink-faint">
      <span className="font-mono">
        {mode === 'paused'
          ? 'paused'
          : mode === 'eased'
            ? 'updates every 30s'
            : 'updates every 3s'}
      </span>
      <button
        type="button"
        onClick={manualRefresh}
        className="transition-colors hover:text-ink"
      >
        refresh
      </button>
    </div>
  );

  if (!jobs.length) {
    return (
      <div className="space-y-3">
        {statusLine}
        <div className="rounded-md border-[0.5px] border-border bg-raised px-5 py-8 text-center text-sm text-ink-faint">
          No jobs waiting.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {statusLine}
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-md border-[0.5px] border-border bg-raised px-5 py-4"
        >
          {/* Phones: thumbnail shrinks one step (110x74) and status +
              action move under the name; the fixed rail columns only
              exist from sm up, so nothing can push off-screen. */}
          <div className="flex items-start gap-4 sm:gap-6">
            <div className="shrink-0 rounded-[2px] border-[0.5px] border-border bg-white">
              <img
                src={`/api/jobs/png?job=${encodeURIComponent(job.id)}`}
                alt=""
                loading="lazy"
                className="h-[74px] w-[110px] object-contain sm:h-[108px] sm:w-[158px]"
              />
            </div>
            <div className="min-w-0 grow pt-0.5">
              {/* the ledger line: name……………status [action] share ONE
                  baseline — the button aligns by its label text */}
              <div className="flex min-w-0 items-baseline gap-3">
                <div className="truncate font-mono text-[13px] text-ink">
                  {job.name}
                </div>
                <span className="leader" aria-hidden="true" />
                <span
                  className={`hidden shrink-0 font-mono text-xs sm:inline ${job.inflight ? 'text-red' : 'text-ink-muted'}`}
                >
                  {job.statusText}
                </span>
                {job.inflight ? (
                  <>
                    <span className="hidden shrink-0 font-mono text-xs text-ink-faint sm:inline">
                      claimed {job.claimedAgo}
                    </span>
                    <button
                      type="button"
                      className="hidden shrink-0 font-mono text-xs text-ink-muted underline underline-offset-2 hover:text-ink sm:inline"
                      onClick={() => requeue(job.id)}
                    >
                      requeue
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="hidden shrink-0 font-mono text-xs text-ink-muted underline underline-offset-2 hover:text-ink sm:inline"
                    onClick={() => cancel(job.id)}
                  >
                    cancel
                  </button>
                )}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {job.source} · created {job.createdTime}
              </div>
              <div className="mt-2 flex items-center gap-3 sm:hidden">
                <span
                  className={`font-mono text-xs ${job.inflight ? 'text-red' : 'text-ink-muted'}`}
                >
                  {job.statusText}
                </span>
                {job.inflight ? (
                  <>
                    <span className="font-mono text-xs text-ink-faint">
                      claimed {job.claimedAgo}
                    </span>
                    <button
                      type="button"
                      className="font-mono text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                      onClick={() => requeue(job.id)}
                    >
                      requeue
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="font-mono text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                    onClick={() => cancel(job.id)}
                  >
                    cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
