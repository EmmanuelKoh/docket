// tests/time-labels.test.ts — the dashboard's time and source labels
// (app/_lib/time.ts, app/_lib/slip-data.ts). Servers run in UTC, so every
// label takes the zone it is for: the viewer's for dates and clock times,
// the slip's own for its next run. Labels are sentence case; the kit
// prints them in capitals by CSS.

import { describe, expect, it } from 'vitest';
import { jobSourceLabels, runLabel, sourceLabel } from '@/app/_lib/slip-data';
import {
  agoLabel,
  clockLabel,
  dateLabel,
  dayKey,
  dayLabel,
  nextRunLabel,
  requestTimeZone,
  validTimeZone,
} from '@/app/_lib/time';

// Fri 16 Oct 2026, 03:30 UTC: still Thursday evening in New York.
const AT = Date.parse('2026-10-16T03:30:00Z');

describe('time labels', () => {
  it('formats the date and clock in the given zone', () => {
    expect(dateLabel(AT, 'UTC')).toBe('Fri 16 Oct 2026');
    expect(dateLabel(AT, 'America/New_York')).toBe('Thu 15 Oct 2026');
    expect(clockLabel(AT, 'UTC')).toBe('03:30');
    expect(clockLabel(AT, 'America/New_York')).toBe('23:30');
    expect(clockLabel(Date.parse('2026-10-16T00:05:00Z'), 'UTC')).toBe('00:05');
    expect(dayKey(AT, 'America/New_York')).toBe('2026-10-15');
    expect(dayKey(AT, 'Asia/Tokyo')).toBe('2026-10-16');
  });

  it('names the day relative to now', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(dayLabel(now - 3600_000, 'UTC', now)).toBe('Today');
    expect(dayLabel(now - 86_400_000, 'UTC', now)).toBe('Yesterday');
    expect(dayLabel(Date.parse('2026-10-13T09:00:00Z'), 'UTC', now)).toBe(
      'Tue 13 Oct',
    );
    expect(dayLabel(Date.parse('2025-12-31T09:00:00Z'), 'UTC', now)).toBe(
      'Wed 31 Dec 2025',
    );
  });

  it('says how long ago in one unit', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(agoLabel(now - 12_000, now)).toBe('12 s');
    expect(agoLabel(now - 3 * 60_000, now)).toBe('3 m');
    expect(agoLabel(now - 2 * 3600_000, now)).toBe('2 h');
    expect(agoLabel(now - 4 * 86_400_000, now)).toBe('4 d');
    expect(agoLabel(now + 5000, now)).toBe('0 s'); // a clock a little ahead
  });

  it("gives a slip's next run in the slip's own zone", () => {
    const tz = 'America/New_York';
    // now: Thu 15 Oct, 23:30 in New York
    const due = (iso: string) => Date.parse(iso);
    // 06:30 New York is 10:30 UTC in October
    expect(nextRunLabel(due('2026-10-16T10:30:00Z'), tz, AT)).toBe(
      'Tomorrow 06:30',
    );
    expect(nextRunLabel(due('2026-10-15T23:45:00Z'), tz, AT)).toBe(
      'Today 19:45',
    );
    expect(nextRunLabel(due('2026-10-17T10:30:00Z'), tz, AT)).toBe('Sat 06:30');
    expect(nextRunLabel(due('2026-10-29T10:30:00Z'), tz, AT)).toBe(
      '29 Oct 06:30',
    );
    // an unknown zone falls back to UTC instead of throwing
    expect(nextRunLabel(AT, 'Not/AZone', AT)).toBe('Today 03:30');
  });

  it('accepts only real zone names from the cookie', () => {
    expect(validTimeZone('Europe/London')).toBe('Europe/London');
    expect(validTimeZone('Mars/Base')).toBeNull();
    expect(validTimeZone('')).toBeNull();
    expect(validTimeZone(null)).toBeNull();
  });

  it("reads the zone from a route's request cookie, else UTC", () => {
    const req = (cookie?: string) =>
      new Request('http://localhost/api/queue', {
        headers: cookie ? { cookie } : {},
      });
    expect(requestTimeZone(req('a=1; tz=America%2FNew_York; b=2'))).toBe(
      'America/New_York',
    );
    expect(requestTimeZone(req('tz=Mars%2FBase'))).toBe('UTC');
    expect(requestTimeZone(req('tz=%E0%A4%A'))).toBe('UTC');
    expect(requestTimeZone(req('notz=Europe%2FLondon'))).toBe('UTC');
    expect(requestTimeZone(req())).toBe('UTC');
  });
});

describe('slip labels', () => {
  const module = (
    id: string,
    meta: Record<string, unknown>,
    scheduled: boolean,
  ) => ({
    id,
    meta,
    templates: [],
    configLabels: {},
    scheduled,
  });
  const record = (r: Record<string, unknown>) => ({
    id: 'x',
    enabled: true,
    ...r,
  });

  it('shows a daily slip by its next run, other slips by their trigger', () => {
    const brief = module('morning-brief', { title: 'Morning brief' }, true);
    const schedule = { at: '06:30', timezone: 'America/New_York' };
    expect(
      runLabel(
        {
          module: brief,
          record: record({
            schedule,
            nextDueAt: Date.parse('2026-10-16T10:30:00Z'),
          }),
        },
        AT,
      ),
    ).toBe('Tomorrow 06:30');
    expect(
      runLabel({
        module: brief,
        record: record({ enabled: false, schedule, nextDueAt: null }),
      }),
    ).toBe('Daily 06:30');

    const cup = module('espn-worldcup', { trigger: 'Each goal' }, true);
    expect(
      runLabel({ module: cup, record: record({ schedule: { every: 60 } }) }),
    ).toBe('Each goal');
    const watcher = module('watcher', {}, true);
    expect(
      runLabel({
        module: watcher,
        record: record({ schedule: { every: 300 } }),
      }),
    ).toBe('Every 5 min');
    const texts = module('texts', {}, false);
    expect(runLabel({ module: texts, record: record({}) })).toBe(
      'Each message',
    );
  });

  it('names job sources by tool or by the slip that printed them', () => {
    const labels = jobSourceLabels([
      {
        module: module(
          'message-ingest',
          { title: 'Text messages', sources: ['sms'] },
          false,
        ),
      },
      { module: module('morning-brief', { title: 'Morning brief' }, true) },
    ]);
    expect(sourceLabel(labels, 'sms')).toBe('Text messages');
    expect(sourceLabel(labels, 'message-ingest')).toBe('Text messages');
    expect(sourceLabel(labels, 'morning-brief')).toBe('Morning brief');
    expect(sourceLabel(labels, 'studio')).toBe('Studio');
    expect(sourceLabel(labels, 'test')).toBe('Test print');
    expect(sourceLabel(labels, 'api')).toBe('Api');
    expect(sourceLabel(labels, undefined)).toBe('');
  });
});
