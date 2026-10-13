// tests/eased-poll.test.ts — the cadence the Queue list and the Studio's
// recent jobs poll at (components/hooks/use-eased-poll.ts pollStep): 3s
// while the person is active, 30s after two idle minutes, nothing after
// thirty. The hook only runs pollStep on its 3s timer while the tab is
// visible and counts pointer, key and tab-return events as activity.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EASE_AFTER_MS,
  EASE_POLL_MS,
  PAUSE_AFTER_MS,
  POLL_MS,
  pollStep,
} from '@/components/hooks/use-eased-poll';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/eased-poll`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const T = 1_000_000_000;
const step = (idleMs: number, sinceFetchMs: number) =>
  pollStep({ now: T, lastActivity: T - idleMs, lastFetch: T - sinceFetchMs });

describe('pollStep', () => {
  it('is the queue cadence: 3s, 30s after two idle minutes, paused after thirty', () => {
    expect([POLL_MS, EASE_AFTER_MS, EASE_POLL_MS, PAUSE_AFTER_MS]).toEqual([
      3_000, 120_000, 30_000, 1_800_000,
    ]);
  });

  it('fetches on every 3s tick while the person is active', () => {
    expect(step(0, POLL_MS)).toEqual({ mode: 'live', fetch: true });
    // a tick that fires a little early still fetches
    expect(step(10_000, POLL_MS - 100)).toEqual({ mode: 'live', fetch: true });
    expect(step(10_000, 1_000)).toEqual({ mode: 'live', fetch: false });
    expect(step(EASE_AFTER_MS, POLL_MS)).toEqual({ mode: 'live', fetch: true });
  });

  it('after two idle minutes, fetches only once 30s have passed', () => {
    const idle = EASE_AFTER_MS + 1;
    expect(step(idle, POLL_MS)).toEqual({ mode: 'eased', fetch: false });
    expect(step(idle, 20_000)).toEqual({ mode: 'eased', fetch: false });
    expect(step(idle, EASE_POLL_MS - 100)).toEqual({
      mode: 'eased',
      fetch: true,
    });
    expect(step(PAUSE_AFTER_MS, EASE_POLL_MS)).toEqual({
      mode: 'eased',
      fetch: true,
    });
  });

  it('after thirty idle minutes, never fetches until activity resumes', () => {
    expect(step(PAUSE_AFTER_MS + 1, EASE_POLL_MS)).toEqual({
      mode: 'paused',
      fetch: false,
    });
    expect(step(24 * 3600_000, 24 * 3600_000)).toEqual({
      mode: 'paused',
      fetch: false,
    });
    // activity again: the next tick fetches at the fast cadence
    expect(step(0, 24 * 3600_000)).toEqual({ mode: 'live', fetch: true });
  });
});
