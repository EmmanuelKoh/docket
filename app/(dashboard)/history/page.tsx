// History: every job that ended, newest first (design spec: pages,
// History). The title has the count at the right and the filter keys
// (All, Printed, Failed, Canceled). Jobs are grouped by the day they
// printed in the viewer's time zone, one module per day, numbered from
// the newest day. Each row opens its record (components/history-list.tsx).
// Filtering and paging are search params (?filter=, ?page=), 20 rows per
// page. No poll: the page shows the state at load.
//
// Reads, all in one go: jobs.list (every ended job, with attempts) and
// slips.list (to name each job's source).

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
import {
  jobSourceLabels,
  type SlipPair,
  sourceLabel,
} from '@/app/_lib/slip-data';
import { clockLabel, dayKey, dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { HistoryList, type HistoryRow } from '@/components/history-list';
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

const plateNumber = (n: number) => String(n).padStart(2, '0');

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

  const [jobs, pairs, tz] = await Promise.all([
    jobsList(caller, {
      limit: 1000,
      status: filter === 'all' ? HISTORY_STATUSES : [filter],
      attempts: true,
    }) as Promise<JobSummary[]>,
    slipsList(caller) as Promise<SlipPair[]>,
    viewerTimeZone(),
  ]);
  const labels = jobSourceLabels(pairs);
  const now = Date.now();

  // Newest print first. Days are numbered from the newest, across pages,
  // so a day split over two pages keeps its number.
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
  const days: {
    key: string;
    label: string;
    number: number;
    rows: HistoryRow[];
  }[] = [];
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
    <>
      <PageTitle
        className="history-head"
        aside={
          <span className="uppercase">
            {all.length} {all.length === 1 ? 'receipt' : 'receipts'}
          </span>
        }
        actions={
          <nav aria-label="Filter">
            <KeyGroup className="history-filter">
              {FILTERS.map((f) => (
                <PushKey
                  key={f.value}
                  href={
                    f.value === 'all'
                      ? '/history'
                      : `/history?filter=${f.value}`
                  }
                  down={f.value === filter}
                >
                  {f.label}
                </PushKey>
              ))}
            </KeyGroup>
          </nav>
        }
      >
        History
      </PageTitle>

      {days.length ? (
        <div className="flex flex-col gap-[30px]">
          {days.map((day) => (
            <Module
              key={day.key}
              number={plateNumber(day.number)}
              title={day.label}
              flush
            >
              <HistoryList rows={day.rows} />
            </Module>
          ))}
        </div>
      ) : (
        <p className="hw-ink m-0">{current.empty}</p>
      )}

      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3"
        >
          <KeyGroup>
            <PushKey href={pageHref(page - 1)} disabled={page <= 1}>
              Newer
            </PushKey>
            <PushKey href={pageHref(page + 1)} disabled={page >= pages}>
              Older
            </PushKey>
          </KeyGroup>
          <span className="hw-mono hw-ink text-[15px]">
            <span aria-hidden="true">
              {page} / {pages}
            </span>
            <span className="sr-only">
              Page {page} of {pages}
            </span>
          </span>
        </nav>
      ) : null}
    </>
  );
}
