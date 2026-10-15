// Home: today at a glance (design spec: pages, Home). Left, today's
// receipts feed out of the printer's front edge at their true 576px,
// newest first: a job the printer holds now is the slip still in the
// printer, captioned "Printing"; the others carry a PRINTED stamp. Right,
// the Printer module (name, LED and state, last seen, jobs waiting) and
// the Slips module (each set-up slip with its next run and its switch).
//
// Reads, all in one go: jobs.list (the newest printed and printing jobs,
// a bounded page), the printer (printers.overview and jobs.queueSize,
// shared with the panel's printer line through React cache) and
// slips.list. No poll: the page shows the state at load; a switch
// refreshes it.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { type JobSummary, jobImageSrc } from '@/app/_lib/format';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import {
  jobSourceLabels,
  runLabel,
  type SlipPair,
  sourceLabel,
} from '@/app/_lib/slip-data';
import {
  ago,
  clockLabel,
  dateLabel,
  dayKey,
  viewerTimeZone,
} from '@/app/_lib/time';
import { Led } from '@/components/hardware/led';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { PaperRoll, PaperSlip, PrinterEdge } from '@/components/hardware/paper';
import { Row, RowText } from '@/components/hardware/row';
import { Stamp } from '@/components/hardware/stamp';
import { Note } from '@/components/hardware/text';
import { SlipSwitch } from '@/components/slip-switch';
import { cn } from '@/components/utils';
import { jobsList } from '@/lib/ops/jobs.js';
import { slipsList } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Today' };

// How many of the newest jobs to read, and how many slips the roll shows.
// A busy day lists the rest in History.
const LIST_LIMIT = 20;
const ROLL_SLIPS = 3;
// A receipt taller than this (in px at true size) is torn off here.
const TEAR_AT = 1100;

// When a job printed: a printer took it then (claimedAt). A job record
// has no separate print time.
const printedAt = (j: JobSummary) => j.claimedAt ?? j.createdAt;

export default async function HomePage() {
  const caller = await getCaller();
  if (!caller?.ownerId) redirect('/login');
  const [jobs, printer, pairs, tz] = await Promise.all([
    jobsList(caller, {
      limit: LIST_LIMIT,
      status: ['inflight', 'done'],
    }) as Promise<JobSummary[]>,
    printerSummary(caller),
    slipsList(caller) as Promise<SlipPair[]>,
    viewerTimeZone(),
  ]);

  const now = Date.now();
  const today = dayKey(now, tz);
  // Today's jobs, the one printing first, then the newest print first
  const todays = jobs
    .filter((j) => dayKey(printedAt(j), tz) === today)
    .sort(
      (a, b) =>
        Number(b.status === 'inflight') - Number(a.status === 'inflight') ||
        Date.parse(printedAt(b)) - Date.parse(printedAt(a)),
    );
  const roll = todays.slice(0, ROLL_SLIPS);
  const more = todays.length - roll.length;
  // Every job read was today's, so there can be more than were read
  const capped = jobs.length === LIST_LIMIT && todays.length === jobs.length;

  const labels = jobSourceLabels(pairs);
  const slips = pairs.flatMap(({ module, record }) =>
    record ? [{ module, record }] : [],
  );

  return (
    <>
      <PageTitle
        aside={<span className="uppercase">{dateLabel(now, tz)}</span>}
      >
        Today
      </PageTitle>

      <div className="flex flex-wrap items-start gap-x-[52px] gap-y-12">
        <section
          aria-label="Today's prints"
          className="min-w-0 flex-[999_1_624px] min-[876px]:pl-[18px]"
        >
          <PrinterEdge />
          {roll.length ? (
            <PaperRoll className="flex flex-col gap-11">
              {roll.map((j, i) => {
                const printing = j.status === 'inflight';
                const source = sourceLabel(labels, j.source);
                const tall = (j.height ?? 0) > TEAR_AT;
                return (
                  <figure key={j.id} className="m-0 flex flex-col gap-3">
                    <PaperSlip
                      src={jobImageSrc(j)}
                      alt={j.name ? `${j.name} receipt` : 'Receipt'}
                      width={j.width ?? 576}
                      height={j.height}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      fed={i === 0}
                      tear={i === 0 ? 'new' : 'old'}
                      rotate={i % 2 ? -0.6 : undefined}
                      shiftX={i % 2 ? 5 : undefined}
                      streakOffset={i % 2 ? -400 : undefined}
                      maxHeight={tall ? TEAR_AT + 30 : undefined}
                    />
                    {printing ? (
                      <figcaption className="hw-caption">
                        <span className="hw-caption-time hw-ink">
                          {clockLabel(printedAt(j), tz)}
                        </span>
                        {source ? (
                          <span className="hw-ink">{source}</span>
                        ) : null}
                        <span className="flex items-center gap-2 font-semibold text-red">
                          <Led state="printing" />
                          Printing
                        </span>
                      </figcaption>
                    ) : (
                      <figcaption className="hw-caption hw-ink">
                        <span className="hw-caption-time">
                          {clockLabel(printedAt(j), tz)}
                        </span>
                        {source || null}
                        <Stamp state="printed" alt={i % 2 === 1} />
                      </figcaption>
                    )}
                  </figure>
                );
              })}
              {more > 0 ? (
                <Link href="/history" className="hw-link self-start">
                  {more}
                  {capped ? '+' : ''} more today
                </Link>
              ) : null}
            </PaperRoll>
          ) : (
            <p className="hw-ink m-0 pt-7 pl-1">Nothing printed today.</p>
          )}
        </section>

        <aside
          aria-label="Status"
          className="flex min-w-[280px] flex-[1_1_300px] flex-col gap-[30px] max-[400px]:min-w-0"
        >
          <Module number="01" title="Printer" bodyClassName="gap-2">
            {printer.name ? (
              <>
                <div className="text-[21px] font-bold leading-tight">
                  {printer.name}
                </div>
                <div
                  className={cn(
                    'flex items-center gap-2.5 font-semibold',
                    printer.state === 'printing' && 'text-red',
                  )}
                >
                  <Led state={printer.state} />
                  {printerStateText(printer.state)}
                </div>
                <Note>
                  {printer.lastSeenAt ? (
                    <>
                      Last seen{' '}
                      <span className="hw-mono">
                        {ago(printer.lastSeenAt, now).value}
                      </span>{' '}
                      {ago(printer.lastSeenAt, now).unit} ago
                    </>
                  ) : (
                    'Not seen yet'
                  )}
                </Note>
              </>
            ) : (
              <>
                <div className="text-[21px] font-bold leading-tight">
                  No printer yet
                </div>
                <Link href="/printer" className="hw-link self-start">
                  Add a printer
                </Link>
              </>
            )}
            {printer.queued > 0 ? (
              <Link href="/queue" className="hw-link self-start text-red">
                {printer.queued} waiting
              </Link>
            ) : null}
          </Module>

          <Module number="02" title="Slips" flush>
            {slips.map(({ module, record }) => {
              const title = module.meta?.title || module.id;
              return (
                <Row key={module.id} tight off={!record.enabled}>
                  <RowText
                    title={title}
                    sub={runLabel({ module, record }, now)}
                  />
                  <SlipSwitch
                    id={module.id}
                    title={title}
                    enabled={record.enabled}
                  />
                </Row>
              );
            })}
            {slips.length === 0 ? (
              <Row>
                <Note>No slips set up yet.</Note>
              </Row>
            ) : null}
            <Link href="/slips" className="hw-link px-4 py-3.5 text-[15px]">
              All slips
            </Link>
          </Module>
        </aside>
      </div>
    </>
  );
}
