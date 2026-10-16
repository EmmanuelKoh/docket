// A dashboard poll that follows the human (docs/store-costs.md): every 3s
// while they are active on the page, every 30s after two idle minutes,
// stopped after thirty, and never while the tab is hidden. Each poll is
// a function invocation and a store read, so a tab parked on a second
// monitor must not bill around the clock. Pointer and key interaction
// (and coming back to the tab) count as activity and resume the fast
// cadence on the next tick; resume() does it at once. The Queue list uses
// it, and the Studio follows a print it sent with it (its refresh fetches
// nothing while no print is followed).

import { useCallback, useEffect, useRef, useState } from 'react';

export const POLL_MS = 3000;
export const EASE_AFTER_MS = 2 * 60 * 1000;
export const EASE_POLL_MS = 30_000;
export const PAUSE_AFTER_MS = 30 * 60 * 1000;

export type PollMode = 'live' | 'eased' | 'paused';

// One timer tick (every POLL_MS, visible tab only): the cadence the poll
// is in, and whether a fetch is due. A fetch is due once its cadence has
// passed since the last one, less 100ms of timer jitter.
export function pollStep({
  now,
  lastActivity,
  lastFetch,
}: {
  now: number;
  lastActivity: number;
  lastFetch: number;
}): { mode: PollMode; fetch: boolean } {
  const idle = now - lastActivity;
  if (idle > PAUSE_AFTER_MS) return { mode: 'paused', fetch: false };
  const mode: PollMode = idle > EASE_AFTER_MS ? 'eased' : 'live';
  const cadence = mode === 'eased' ? EASE_POLL_MS : POLL_MS;
  return { mode, fetch: now - lastFetch >= cadence - 100 };
}

// refresh should be stable (useCallback). immediate: fetch on mount too
// (for a list the server did not render). Returns the mode, refresh (a
// fetch that counts toward the cadence) and resume (activity + fetch).
export function useEasedPoll(
  refresh: () => unknown,
  { immediate = false }: { immediate?: boolean } = {},
) {
  const [mode, setMode] = useState<PollMode>('live');
  const lastActivity = useRef(Date.now());
  const lastFetch = useRef(Date.now());

  const poll = useCallback(() => {
    lastFetch.current = Date.now();
    return refresh();
  }, [refresh]);

  const resume = useCallback(() => {
    lastActivity.current = Date.now();
    setMode('live');
    return poll();
  }, [poll]);

  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    document.addEventListener('visibilitychange', bump);
    if (immediate) poll();

    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const step = pollStep({
        now: Date.now(),
        lastActivity: lastActivity.current,
        lastFetch: lastFetch.current,
      });
      setMode(step.mode);
      if (step.fetch) poll();
    }, POLL_MS);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      document.removeEventListener('visibilitychange', bump);
    };
  }, [poll, immediate]);

  return { mode, refresh: poll, resume };
}
