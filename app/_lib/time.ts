// app/_lib/time.ts: dates and times as the viewer reads them. Vercel
// functions run in UTC, so pages format times in the viewer's time zone,
// which components/time-zone-cookie.tsx stores in the "tz" cookie on the
// first visit. A slip's next run is shown in the slip's own time zone.
//
// The formatters return sentence case ("Fri 16 Oct 2026", "Tomorrow
// 06:30"). The kit prints them in capitals by CSS (.hw-row-sub does it;
// add `uppercase` elsewhere), so screen readers get readable words.
// Only Intl here: the boundary lock keeps lib/schedule.js out of app/.

import { cookies } from 'next/headers';

export const TZ_COOKIE = 'tz';
const FALLBACK = 'UTC';

/** A valid IANA zone name, or null. */
export function validTimeZone(name: string | null | undefined): string | null {
  if (!name) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: name,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The viewer's time zone from the cookie; UTC until the browser sets it. */
export async function viewerTimeZone(): Promise<string> {
  const jar = await cookies();
  return validTimeZone(jar.get(TZ_COOKIE)?.value) ?? FALLBACK;
}

/** The same, read from a route handler's request (no request scope needed). */
export function requestTimeZone(req: Request): string {
  const header = req.headers.get('cookie') ?? '';
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TZ_COOKIE}=`));
  const value = pair ? pair.slice(TZ_COOKIE.length + 1) : null;
  let name: string | null = null;
  try {
    name = value ? decodeURIComponent(value) : null;
  } catch {
    name = null;
  }
  return validTimeZone(name) ?? FALLBACK;
}

type When = Date | string | number;
const toDate = (w: When) => (w instanceof Date ? w : new Date(w));

// One formatter per zone and shape: Intl formatters are slow to build.
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, kind: 'parts' | 'clock'): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  let f = formatters.get(key);
  if (!f) {
    f =
      kind === 'clock'
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          })
        : new Intl.DateTimeFormat('en-GB', {
            timeZone,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
    formatters.set(key, f);
  }
  return f;
}

type DayParts = {
  weekday: string;
  day: number;
  month: string;
  year: number;
  /** Days since 1970-01-01 for this calendar date, to compare dates. */
  serial: number;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function dayParts(when: When, timeZone: string): DayParts {
  const parts = fmt(timeZone, 'parts').formatToParts(toDate(when));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = get('month').slice(0, 3);
  const day = Number(get('day'));
  const monthIndex = MONTHS.indexOf(month);
  return {
    weekday: get('weekday').slice(0, 3),
    day,
    month,
    year,
    serial: Math.floor(Date.UTC(year, monthIndex, day) / 86_400_000),
  };
}

/** "Fri 16 Oct 2026" */
export function dateLabel(when: When, timeZone: string): string {
  const d = dayParts(when, timeZone);
  return `${d.weekday} ${d.day} ${d.month} ${d.year}`;
}

/** "17:30", 24-hour. */
export function clockLabel(when: When, timeZone: string): string {
  return fmt(timeZone, 'clock').format(toDate(when));
}

/** "2026-10-16": the calendar date in that zone, to group or filter by day. */
export function dayKey(when: When, timeZone: string): string {
  const d = dayParts(when, timeZone);
  const mm = String(MONTHS.indexOf(d.month) + 1).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

/** "Today", "Yesterday", or "Tue 13 Oct" (with the year when it differs). */
export function dayLabel(
  when: When,
  timeZone: string,
  now: When = Date.now(),
): string {
  const d = dayParts(when, timeZone);
  const today = dayParts(now, timeZone);
  const diff = today.serial - d.serial;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.year === today.year
    ? `${d.weekday} ${d.day} ${d.month}`
    : `${d.weekday} ${d.day} ${d.month} ${d.year}`;
}

/** How long ago, as a number and a unit: { value: 12, unit: 's' }. */
export function ago(
  when: When,
  now: When = Date.now(),
): { value: number; unit: 's' | 'm' | 'h' | 'd' } {
  const s = Math.max(
    0,
    Math.floor((toDate(now).getTime() - toDate(when).getTime()) / 1000),
  );
  if (s < 60) return { value: s, unit: 's' };
  if (s < 3600) return { value: Math.floor(s / 60), unit: 'm' };
  if (s < 86_400) return { value: Math.floor(s / 3600), unit: 'h' };
  return { value: Math.floor(s / 86_400), unit: 'd' };
}

/** "12 s", "3 m", "2 h", "4 d" (write "ago" after it). */
export function agoLabel(when: When, now: When = Date.now()): string {
  const a = ago(when, now);
  return `${a.value} ${a.unit}`;
}

/**
 * The next run of a slip with a daily time, in the slip's own zone:
 * "Today 06:30", "Tomorrow 06:30", "Fri 06:30" within a week, else
 * "23 Oct 06:30".
 */
export function nextRunLabel(
  nextDueAt: When,
  timeZone: string,
  now: When = Date.now(),
): string {
  const tz = validTimeZone(timeZone) ?? FALLBACK;
  const due = dayParts(nextDueAt, tz);
  const diff = due.serial - dayParts(now, tz).serial;
  const time = clockLabel(nextDueAt, tz);
  if (diff <= 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff < 7) return `${due.weekday} ${time}`;
  return `${due.day} ${due.month} ${time}`;
}
