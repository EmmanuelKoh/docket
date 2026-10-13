// History — "N jobs · newest first", filter control right, one list
// container with expandable rows (components/history-list.tsx), and
// centered "← newer  1 / N  older →" pagination. Filtering and paging are
// searchParams, like the legacy page's query string.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { HistoryList, type HistoryRow } from '@/components/history-list';
import { jobsList } from '@/lib/ops/jobs.js';
import {
  agoShort,
  failedAttempts,
  HISTORY_STATUSES,
  historyStamp,
  type JobSummary,
  jobImageSrc,
} from '../../_lib/format';

const PER_PAGE = 20;
const FILTERS = ['all', ...HISTORY_STATUSES];

function statusColor(status: string): string {
  if (status === 'failed') return 'text-red';
  if (status === 'canceled') return 'text-ink-faint';
  return 'text-ink-muted';
}

function historyRow(j: JobSummary): HistoryRow {
  return {
    id: j.id,
    image: jobImageSrc(j),
    name: j.name || j.id,
    sub: [j.source || '—', failedAttempts(j.attempts)]
      .filter(Boolean)
      .join(' · '),
    statusText: j.status,
    statusColor: statusColor(j.status),
    stamp: historyStamp(j.status),
    railTime: agoShort(j.createdAt),
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

  const all: JobSummary[] = await jobsList(caller, {
    limit: 1000,
    status: filter === 'all' ? HISTORY_STATUSES : [filter],
    attempts: true,
  });
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(
    Math.max(1, parseInt(params.page || '1', 10) || 1),
    pages,
  );
  const rows = all
    .slice((page - 1) * PER_PAGE, page * PER_PAGE)
    .map(historyRow);

  const pageHref = (p: number) =>
    `/history?${new URLSearchParams({
      ...(filter !== 'all' ? { filter } : {}),
      ...(p > 1 ? { page: String(p) } : {}),
    }).toString()}`.replace(/\?$/, '');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-base font-medium text-ink">History</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {all.length} job{all.length === 1 ? '' : 's'} · newest first
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={f === 'all' ? '/history' : `/history?filter=${f}`}
              className={
                f === filter
                  ? 'border-b border-dotted border-ink-faint text-ink'
                  : 'text-ink-muted hover:text-ink'
              }
            >
              {f}
            </Link>
          ))}
        </div>
      </div>

      <HistoryList rows={rows} />

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-4 text-xs text-ink-muted">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="hover:text-ink">
              ← newer
            </Link>
          ) : (
            <span className="text-ink-faint">← newer</span>
          )}
          <span className="font-mono">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="hover:text-ink">
              older →
            </Link>
          ) : (
            <span className="text-ink-faint">older →</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
