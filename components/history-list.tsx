'use client';

// History rows in one list container. Clicking a row expands an inset
// panel (--page bg, indented past the thumbnail): PRINTED (the receipt
// PNG at 200px), TEMPLATE (truncated source), DATA (the JSON), plus a
// Reprint button. Detail loads on first expand from /api/jobs/detail.

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export type HistoryRow = {
  id: string;
  name: string;
  sub: string;
  statusText: string;
  statusColor: string;
  railTime: string;
};

type Detail = { template: string; dataJson: string };

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail | null>>({});
  const [reprintStatus, setReprintStatus] = useState<Record<string, string>>(
    {},
  );

  async function toggle(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && details[next] === undefined) {
      setDetails((d) => ({ ...d, [next]: null })); // loading
      try {
        const res = await fetch(
          `/api/jobs/detail?job=${encodeURIComponent(next)}`,
        );
        const data = res.ok ? await res.json() : null;
        setDetails((d) => ({ ...d, [next]: data }));
      } catch {
        setDetails((d) => ({ ...d, [next]: null }));
      }
    }
  }

  async function reprint(id: string) {
    setReprintStatus((s) => ({ ...s, [id]: 'queueing…' }));
    try {
      const res = await fetch(
        `/api/jobs/reprint?job=${encodeURIComponent(id)}`,
        { method: 'POST' },
      );
      const data = await res.json();
      setReprintStatus((s) => ({
        ...s,
        [id]: res.ok ? `queued ${data.queued}` : data.error || 'reprint failed',
      }));
    } catch {
      setReprintStatus((s) => ({ ...s, [id]: 'reprint failed' }));
    }
  }

  if (!rows.length) {
    return (
      <div className="rounded-md border-[0.5px] border-border bg-raised px-5 py-8 text-center text-sm text-ink-faint">
        Nothing here yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border-[0.5px] border-border bg-raised">
      {rows.map((row, i) => {
        const open = openId === row.id;
        const detail = details[row.id];
        const status = reprintStatus[row.id];
        return (
          <div
            key={row.id}
            className={i > 0 ? 'border-t-[0.5px] border-t-hairline' : ''}
          >
            <button
              type="button"
              onClick={() => toggle(row.id)}
              className="flex w-full items-start gap-6 px-5 py-4 text-left"
            >
              <div className="shrink-0 rounded-[2px] border-[0.5px] border-border bg-white">
                <img
                  src={`/api/jobs/png?job=${encodeURIComponent(row.id)}`}
                  alt=""
                  loading="lazy"
                  className="h-[86px] w-[130px] object-contain"
                />
              </div>
              <div className="min-w-0 grow pt-0.5">
                <div className="truncate font-mono text-[13px] text-ink">
                  {row.name}
                </div>
                <div className="mt-0.5 text-xs text-ink-faint">{row.sub}</div>
              </div>
              <div className="w-[118px] shrink-0 whitespace-nowrap pt-0.5 text-right font-mono text-xs">
                <span className={row.statusColor}>{row.statusText}</span>
                <span className="text-ink-faint"> · {row.railTime}</span>
              </div>
              <span className="pt-0.5 text-ink-faint">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>

            {open ? (
              <div className="bg-page px-5 py-4 sm:pl-[162px]">
                <div className="grid gap-5 sm:grid-cols-[auto_1fr_1fr]">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      Printed
                    </div>
                    <div className="mt-2 inline-block rounded-[2px] border-[0.5px] border-border bg-white p-1">
                      <img
                        src={`/api/jobs/png?job=${encodeURIComponent(row.id)}`}
                        alt={row.name}
                        className="w-[200px]"
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      Template
                    </div>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-muted">
                      {detail === undefined || detail === null
                        ? detail === null && open
                          ? 'loading…'
                          : ''
                        : detail.template}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      Data
                    </div>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-muted">
                      {detail?.dataJson || ''}
                    </pre>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto px-3 py-1.5 text-xs font-normal"
                    onClick={() => reprint(row.id)}
                  >
                    Reprint
                  </Button>
                  {status ? (
                    <span
                      className={`font-mono text-xs ${status.includes('failed') ? 'text-red' : 'text-ink-muted'}`}
                    >
                      {status}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
