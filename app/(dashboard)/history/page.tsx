// History: every job that ended, newest first (design spec: pages,
// History). The deck (the receipt counter, the filter keys All, Printed,
// Failed, Canceled, and Reprint), then one record sheet per day the jobs
// printed, in the viewer's time zone, numbered from the newest day. The
// markup is components/history-view.tsx; each entry opens its record in
// place (components/history-list.tsx). Filtering and paging are search
// params (?filter=, ?page=), 20 entries per page. No poll: the page shows
// the state at load.
//
// Reads, all in one go: jobs.list (every ended job, with attempts),
// slips.list (to name each job's source) and the printer for the lamp
// (shared with the nav unit's printer line through React cache).

import './history.css';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import {
  failedAttempts,
  HISTORY_STATUSES,
  historyStamp,
  type JobSummary,
  jobImageSrc,
} from '@/app/_lib/format';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import {
  jobSourceLabels,
  type SlipPair,
  sourceLabel,
} from '@/app/_lib/slip-data';
import { clockLabel, dayKey, dayLabel, viewerTimeZone } from '@/app/_lib/time';
import type { HistoryRow } from '@/components/history-list';
import { type HistoryDay, HistoryView } from '@/components/history-view';
import { jobsList } from '@/lib/ops/jobs.js';
import { slipsList } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'History' };

const PER_PAGE = 20;

// The filter keys and what an empty list says under each
const FILTERS = [
  { value: 'all', label: 'All', empty: 'Nothing printed yet.' },
  { value: 'done', label: 'Printed', empty: 'Nothing printed yet.' },
  { value: 'failed', label: 'Failed', empty: 'No failed jobs.' },
  { value: 'canceled', label: 'Canceled', empty: 'No canceled jobs.' },
];

// When a job printed: a printer took it then (claimedAt). A job no
// printer took (canceled while it waited) shows when it was made.
const printedAt = (j: JobSummary) => j.claimedAt ?? j.createdAt;

function historyRow(
  j: JobSummary,
  labels: Map<string, string>,
  tz: string,
): HistoryRow {
  return {
    id: j.id,
    image: jobImageSrc(j),
    width: j.width ?? 576,
    height: j.height,
    name: j.name || j.id,
    source: sourceLabel(labels, j.source),
    time: clockLabel(printedAt(j), tz),
    stamp: historyStamp(j.status),
    attempts: failedAttempts(j.attempts),
    // the Reprint route refuses the rest; raw rows the old deployment
    // inserted after the migration still say 'template' but lack one
    reprintable: j.kind === 'template' && j.hasTemplate,
  };
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const params = await searchParams;
  const filter = HISTORY_STATUSES.includes(params.filter || '')
    ? (params.filter as string)
    : 'all';

  const [jobs, pairs, tz, printer] = await Promise.all([
    jobsList(caller, {
      limit: 1000,
      status: filter === 'all' ? HISTORY_STATUSES : [filter],
      attempts: true,
    }) as Promise<JobSummary[]>,
    slipsList(caller) as Promise<SlipPair[]>,
    viewerTimeZone(),
    // the lamp only: a failed read leaves it out rather than the page
    printerSummary(caller).catch((err) => {
      console.error('[history printer]', err);
      return null;
    }),
  ]);
  const labels = jobSourceLabels(pairs);
  const now = Date.now();

  // Newest print first. Days are numbered from the newest, across pages,
  // so a day split over two pages keeps its number (and its sheet's lie).
  const all = [...jobs].sort(
    (a, b) => Date.parse(printedAt(b)) - Date.parse(printedAt(a)),
  );
  const dayOf = new Map<string, string>();
  const dayNumbers = new Map<string, number>();
  for (const j of all) {
    const key = dayKey(printedAt(j), tz);
    dayOf.set(j.id, key);
    if (!dayNumbers.has(key)) dayNumbers.set(key, dayNumbers.size + 1);
  }

  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(
    Math.max(1, parseInt(params.page || '1', 10) || 1),
    pages,
  );
  const days: HistoryDay[] = [];
  for (const j of all.slice((page - 1) * PER_PAGE, page * PER_PAGE)) {
    const key = dayOf.get(j.id) as string;
    let day = days.at(-1);
    if (day?.key !== key) {
      day = {
        key,
        label: dayLabel(printedAt(j), tz, now),
        number: dayNumbers.get(key) as number,
        rows: [],
      };
      days.push(day);
    }
    day.rows.push(historyRow(j, labels, tz));
  }

  const pageHref = (p: number) =>
    `/history?${new URLSearchParams({
      ...(filter !== 'all' ? { filter } : {}),
      ...(p > 1 ? { page: String(p) } : {}),
    }).toString()}`.replace(/\?$/, '');
  const current = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];

  return (
    <HistoryView
      // a new filter or page starts with no record open
      key={`${filter}:${page}`}
      count={all.length}
      filters={FILTERS.map((f) => ({
        label: f.label,
        href: f.value === 'all' ? '/history' : `/history?filter=${f.value}`,
        current: f.value === filter,
      }))}
      lamp={
        printer
          ? printer.name
            ? { state: printer.state, text: printerStateText(printer.state) }
            : { state: 'offline', text: 'No printer' }
          : null
      }
      days={days}
      empty={{ title: current.label, text: current.empty }}
      pager={
        pages > 1
          ? {
              page,
              pages,
              newer: page > 1 ? pageHref(page - 1) : null,
              older: page < pages ? pageHref(page + 1) : null,
            }
          : null
      }
    />
  );
}
