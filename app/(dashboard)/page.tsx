// Overview — the landing page. LATEST PRINT hero (receipt on a white
// panel: receipts are paper, in both themes), the 4-cell stat strip (one
// bordered container split by hairlines; queue number red only when
// nonzero), the system line (online dot per the 90-second rule), and
// RECENT: the three newest history rows. Data shapes ported from the
// legacy homePage() in api/dashboard.js.

import Link from 'next/link';
import { ReceiptPreview } from '@/components/receipt-preview';
import { HEARTBEAT_SECONDS, OWNER_ID, STORE_DRIVER } from '@/config.js';
import { listJobs } from '@/lib/job-store.js';
import { listPlugins } from '@/lib/plugin-registry.js';
import { getState } from '@/lib/state-store.js';
import { getTemplates } from '@/lib/store.js';
import pkg from '@/package.json';
import {
  agoShort,
  agoText,
  HISTORY_STATUSES,
  type JobSummary,
} from '../_lib/format';

function statusColor(status: string): string {
  if (status === 'failed') return 'text-red';
  if (status === 'canceled') return 'text-ink-faint';
  return 'text-ink-muted';
}

export default async function OverviewPage() {
  const [templates, plugins, jobs, device] = await Promise.all([
    getTemplates(),
    listPlugins(OWNER_ID),
    listJobs(1000) as Promise<JobSummary[]>,
    getState('device'),
  ]);

  const queued = jobs.filter((j) => j.status === 'queued').length;
  const printing = jobs.filter((j) => j.status === 'inflight').length;
  const history = jobs.filter((j) => HISTORY_STATUSES.includes(j.status));
  const last = history[0];

  const queueSubParts = [];
  if (printing) queueSubParts.push(`${printing} printing`);
  if (queued) queueSubParts.push(`${queued} queued`);
  const queueSub = queueSubParts.join(' · ') || 'nothing waiting';

  const lastSeen = device?.lastSeenAt as string | undefined;
  const stale =
    !lastSeen || Date.now() - new Date(lastSeen).getTime() > 90 * 1000;

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
              src={`/api/jobs/png?job=${encodeURIComponent(last.id)}`}
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
            className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? 'bg-ink-faint' : 'bg-ink'}`}
          />
          {lastSeen
            ? `device seen ${agoText(lastSeen)}`
            : 'no device contact yet'}
        </span>
        <span>store: {STORE_DRIVER}</span>
        <span>tick: {HEARTBEAT_SECONDS}s</span>
        <span className="ml-auto text-ink-faint">v{pkg.version}</span>
      </div>

      <div className="border-t border-dashed border-dash" />

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
            {history.slice(0, 3).map((j, i) => (
              <div
                key={j.id}
                className={`flex items-start gap-4 px-4 py-4 sm:gap-6 sm:px-5 ${i > 0 ? 'border-t-[0.5px] border-t-hairline' : ''}`}
              >
                <div className="shrink-0 rounded-[2px] border-[0.5px] border-border bg-white">
                  <img
                    src={`/api/jobs/png?job=${encodeURIComponent(j.id)}`}
                    alt=""
                    loading="lazy"
                    className="h-16 w-24 object-contain sm:h-[86px] sm:w-[130px]"
                  />
                </div>
                <div className="min-w-0 grow">
                  <div className="truncate font-mono text-[13px] text-ink">
                    {j.name || j.id}
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
                <div className="hidden w-[118px] shrink-0 whitespace-nowrap text-right font-mono text-xs sm:block">
                  <span className={statusColor(j.status)}>{j.status}</span>
                  <span className="text-ink-faint">
                    {' '}
                    · {agoShort(j.createdAt)}
                  </span>
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
