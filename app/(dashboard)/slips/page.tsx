// Slips — everything the printer can produce, grouped by category.
// Card and section grammar follows byos_next's recipes index (category
// label + count chip + hairline rule; 1/2/3-column responsive grid;
// aspect-ratio preview with chips overlaid; name row with the corner
// arrow; description; mt-auto footer) re-voiced with docket tokens: hero
// is the real rendered receipt on white, top-cropped with the dashed
// edge, names are mono, hover shifts the border to --ink-faint (no
// shadows or motion). The card IS the button. "New template" opens the
// Studio blank.

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { groupByCategory, listSlips } from '../../_lib/slip-data';

export default async function SlipsPage() {
  const slips = await listSlips();
  const groups = groupByCategory(slips);

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium text-ink">Slips</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {slips.length} slip{slips.length === 1 ? '' : 's'} · open one to
            configure, preview, and print
          </p>
        </div>
        <a
          href="/studio?new=1"
          className="shrink-0 whitespace-nowrap rounded-md border-[0.5px] border-border bg-raised px-3 py-1.5 text-xs text-ink hover:border-ink-faint"
        >
          New template
        </a>
      </div>

      {groups.map((group) => (
        <section key={group.category} className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              {group.category}
            </span>
            <span className="rounded-full border-[0.5px] border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
              {group.slips.length}
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
          {/* fixed 400px cards (the receipt-paper width) so the receipt in
              each card lands at the same size as every other preview; full
              width on screens narrower than the paper */}
          <div
            className="grid items-start gap-5"
            style={{
              gridTemplateColumns:
                'repeat(auto-fill, minmax(min(100%, 400px), 400px))',
            }}
          >
            {group.slips.map((r) => (
              <Link
                key={r.slug}
                href={`/slips/${encodeURIComponent(r.slug)}`}
                className="group flex flex-col overflow-hidden rounded-md border-[0.5px] border-border bg-raised transition-colors hover:border-ink-faint"
              >
                {/* the full receipt at paper width on white, like every
                    other preview; the chips sit in the top white margin */}
                <div className="relative border-b border-dashed border-dash bg-white pb-4">
                  {r.primaryTemplate ? (
                    /* same paper treatment as the other previews: the
                       receipt inset on white at 92.3%, centered */
                    <img
                      src={`/api/templates/thumb?name=${encodeURIComponent(r.primaryTemplate)}`}
                      alt={`${r.title} preview`}
                      loading="lazy"
                      className="mx-auto mt-9 block w-[92.3%]"
                    />
                  ) : null}
                  <div className="absolute left-2 top-2 flex items-center gap-1">
                    <span className="rounded-[4px] border-[0.5px] border-black/10 bg-white/85 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-neutral-600 backdrop-blur">
                      {r.kind}
                    </span>
                    {r.kind === 'system' ? (
                      <span
                        className={`rounded-[4px] border-[0.5px] border-black/10 bg-white/85 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] backdrop-blur ${r.enabled ? 'text-neutral-600' : 'text-neutral-400'}`}
                      >
                        {r.enabled ? 'enabled' : 'off'}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-mono text-sm font-medium text-ink">
                      {r.title}
                    </span>
                    <ArrowUpRight
                      size={16}
                      className="mt-0.5 shrink-0 text-ink-faint transition-colors group-hover:text-ink"
                    />
                  </div>
                  {r.description ? (
                    <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
                      {r.description}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-ink-faint">
                    <span>liquid</span>
                    <span className="font-mono">
                      {r.templates.length} template
                      {r.templates.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
