// Overview — the landing page. LATEST PRINT hero (receipt on a white
// panel: receipts are paper, in both themes), the 4-cell stat strip (one
// bordered container split by hairlines; queue number red only when
// nonzero), the system line (online dot per the 90-second rule), and
// RECENT: the three newest history rows. The history rows come from
// jobs.list, the queue cell from jobs.queueSize (the same read as the
// sidebar badge, shared per request: no listing of live jobs), printer
// presence from printers.status (the same online rule as Printer), the
// template count from templates.list, the plugin count from slips.list.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { queueSize } from '@/app/_lib/queue-data';
import { ReceiptPreview } from '@/components/receipt-preview';
import { jobsList } from '@/lib/ops/jobs.js';
import { printersStatus } from '@/lib/ops/printers.js';
import { slipsList } from '@/lib/ops/slips.js';
import { templatesList } from '@/lib/ops/templates.js';
import pkg from '@/package.json';
import {
  agoShort,
  agoText,
  HISTORY_STATUSES,
  type JobSummary,
  jobImageSrc,
} from '../_lib/format';

function statusColor(status: string): string {
  if (status === 'failed') return 'text-red';
  if (status === 'canceled') return 'text-ink-faint';
  return 'text-ink-muted';
}

export default async function OverviewPage() {
  const caller = await getCaller();
  if (!caller?.ownerId) redirect('/login');
  const [templates, slips, size, history, presence] = await Promise.all([
    templatesList(caller),
    slipsList(caller),
    queueSize(caller),
    // newest first: the hero and the three RECENT rows
    jobsList(caller, { limit: 3, status: HISTORY_STATUSES }) as Promise<
      JobSummary[]
    >,
    // a member reads the shared printer's heartbeat (primary owner's slot)
    printersStatus(caller),
  ]);

  // registered system slips (a module without a record has not been set
  // up: the Slips pages register on view)
  const plugins = slips.flatMap((p) => (p.record ? [p.record] : []));
  const { queued, inflight: printing } = size;
  const last = history[0];

  const queueSubParts = [];
  if (printing) queueSubParts.push(`${printing} printing`);
  if (queued) queueSubParts.push(`${queued} queued`);
  const queueSub = queueSubParts.join(' · ') || 'nothing waiting';

  const { lastSeenAt: lastSeen, online } = presence;

  const stats = [
    { label: 'Templates', value: templates.length, sub: 'in the store' },
    {
      label: 'Plugins',
      value: plugins.filter((p: { enabled: boolean }) => p.enabled).length,
      sub: `of ${plugins.length} registered`,
    },
    {
      label: 'Queue',
      value: queued + printing,
      sub: queueSub,
      red: queued + printing > 0,
    },
    {
      label: 'Last print',
      value: last ? agoShort(last.createdAt) : '—',
      sub: last ? last.name || last.id : 'no prints yet',
    },
  ];

  return (
    <div className="space-y-5">
      {/* latest print */}
      <section className="rounded-md border-[0.5px] border-border bg-raised p-4">
        <div className="text-[13px] font-semibold text-ink">Latest print</div>
        {last ? (
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-start">
            <ReceiptPreview
              src={jobImageSrc(last)}
              alt={last.name || last.id}
              className="sm:w-[400px] sm:shrink-0"
            />
            <div className="min-w-0 pt-1">
              <div className="truncate font-mono text-[13px] text-ink">
                {last.name || last.id}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {last.source || '—'} · {last.status} {agoText(last.createdAt)}
              </div>
              <Link
                href="/history"
                className="mt-3 inline-block text-xs text-ink-muted hover:text-ink"
              >
                view in history →
              </Link>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-faint">Nothing printed yet.</p>
        )}
      </section>

      {/* stat strip: one container split by hairlines */}
      <section className="grid grid-cols-2 rounded-md border-[0.5px] border-border bg-raised sm:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`p-4 ${i > 0 ? 'border-l-[0.5px] border-l-hairline max-sm:odd:border-l-0' : ''} ${i >= 2 ? 'max-sm:border-t-[0.5px] max-sm:border-t-hairline' : ''}`}
          >
            <div className="text-[13px] font-semibold text-ink">{s.label}</div>
            <div
              className={`mt-2 font-mono text-[28px] leading-none ${s.red ? 'text-red' : 'text-ink'}`}
            >
              {s.value}
            </div>
            <div className="mt-1.5 truncate text-xs text-ink-muted">
              {s.sub}
            </div>
          </div>
        ))}
      </section>

      {/* system line */}
      <div className="flex flex-wrap items-center gap-6 px-1 text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${online ? 'bg-ink' : 'bg-ink-faint'}`}
          />
          {lastSeen
            ? `printer seen ${agoText(lastSeen)}`
            : 'no printer contact yet'}
        </span>
        <span className="ml-auto text-ink-faint">v{pkg.version}</span>
      </div>

      <div className="perf" />

      {/* recent */}
      <section>
        <div className="flex items-baseline justify-between">
          <div className="text-[13px] font-semibold text-ink">Recent</div>
          <Link
            href="/history"
            className="text-xs text-ink-muted hover:text-ink"
          >
            view all →
          </Link>
        </div>
        {history.length ? (
          <div className="mt-2 rounded-md border-[0.5px] border-border bg-raised">
            {history.map((j, i) => (
              <div
                key={j.id}
                className={`flex items-start gap-4 px-4 py-4 sm:gap-6 sm:px-5 ${i > 0 ? 'border-t-[0.5px] border-t-hairline' : ''}`}
              >
                <div className="shrink-0 rounded-[2px] border-[0.5px] border-border bg-white">
                  <img
                    src={jobImageSrc(j)}
                    alt=""
                    loading="lazy"
                    className="h-16 w-24 object-contain sm:h-[86px] sm:w-[130px]"
                  />
                </div>
                <div className="min-w-0 grow">
                  {/* the ledger line: name……………status · time share ONE
                      baseline so the leader runs into the rail text */}
                  <div className="flex min-w-0 items-baseline">
                    <div className="truncate font-mono text-[13px] text-ink">
                      {j.name || j.id}
                    </div>
                    <span className="leader" aria-hidden="true" />
                    <span className="hidden shrink-0 whitespace-nowrap font-mono text-xs sm:inline">
                      <span className={statusColor(j.status)}>{j.status}</span>
                      <span className="text-ink-faint">
                        {' '}
                        · {agoShort(j.createdAt)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {j.source || '—'}
                  </div>
                  <div className="mt-2 whitespace-nowrap font-mono text-xs sm:hidden">
                    <span className={statusColor(j.status)}>{j.status}</span>
                    <span className="text-ink-faint">
                      {' '}
                      · {agoShort(j.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-faint">Nothing printed yet.</p>
        )}
      </section>
    </div>
  );
}
