// Home: today at a glance (design spec: pages, Home). TODAY and the date
// over the mat, today's slips at real size, and the printer as one
// machine body: the newest slip rises out of the platen in its top edge,
// its caption under the platen, then the printer's name, LED and state,
// LAST SEEN in a counter window, and the slips' switches on a plate
// below. The slips torn off earlier lie on the mat, newest first, each
// slip's bottom edge the same tear as the next newer slip's top. A job a
// printer holds now is captioned Printing (red LED) instead of PRINTED.
//
// Reads, all in one go: jobs.list (the newest printed and printing jobs,
// a bounded page), the printer (printers.overview and jobs.queueSize,
// shared with the nav's printer line through React cache) and
// slips.list. No poll: the page shows the state at load; a switch
// refreshes it.

import './home.css';
import './home-tears.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
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
import { Body, Plate } from '@/components/hardware/kit/body';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Lamp, Led } from '@/components/hardware/kit/led';
import { Platen } from '@/components/hardware/kit/screen';
import { Row, Rows, RowText } from '@/components/hardware/kit/sheet';
import { Slip } from '@/components/hardware/kit/slip';
import { Stamp } from '@/components/hardware/stamp';
import { SlipSwitch } from '@/components/slip-switch';
import { cn } from '@/components/utils';
import { jobsList } from '@/lib/ops/jobs.js';
import { slipsList } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Today' };

// How many of the newest jobs to read, and how many slips show: the one
// in the printer and three on the mat. A busy day lists the rest in
// History.
const LIST_LIMIT = 20;
const SHOWN = 4;
// A receipt taller than this (in dots) is torn off here: 550px of print
// at real size, 594px of paper with the slip's margins.
const TEAR_AT = 1100;
const PRINT_W = 288;
const PAPER_Y = 18 + 26;
// A job with no stored size: a typical receipt's height in dots.
const TYPICAL_DOTS = 384;

// How each torn-off slip lies on the mat (rotation, shift) and the angle
// of its stamp. The fed slip's stamp is FED_STAMP.
const LIE = [
  { rot: -0.7, x: 2, y: 0, stamp: -2.2 },
  { rot: 0.45, x: -1.5, y: 9, stamp: -3.1 },
  { rot: -0.3, x: 4, y: -3, stamp: -1.1 },
];
const FED_STAMP = -2.6;

// The last-seen counter's unit, engraved outside the window
const SEEN_UNIT = { s: 'Sec', m: 'Min', h: 'Hr', d: 'Day' } as const;
const SEEN_WORD = { s: 'second', m: 'minute', h: 'hour', d: 'day' } as const;

// When a job printed: a printer took it then (claimedAt). A job record
// has no separate print time.
const printedAt = (j: JobSummary) => j.claimedAt ?? j.createdAt;

const receiptAlt = (j: JobSummary) =>
  j.name ? `${j.name} receipt` : 'Receipt';

/** The print's height at real size, cut where a long receipt tears off. */
function printHeight(j: JobSummary) {
  const dots = Math.min(j.height ?? TYPICAL_DOTS, TEAR_AT);
  return (dots * PRINT_W) / (j.width || 576);
}

function Caption({
  job,
  source,
  tz,
  stamp,
  alt,
  as: Tag = 'figcaption',
  className,
}: {
  job: JobSummary;
  source: string;
  tz: string;
  stamp: number;
  alt: boolean;
  as?: 'figcaption' | 'p';
  className?: string;
}) {
  const time = clockLabel(printedAt(job), tz);
  if (job.status === 'inflight') {
    return (
      <Tag className={cn('hm-cap hw-caption', className)}>
        <span className="hw-caption-time hw-ink">{time}</span>
        {source ? <span className="hw-ink">{source}</span> : null}
        <span className="hm-printing">
          <Led state="printing" />
          Printing
        </span>
      </Tag>
    );
  }
  return (
    <Tag className={cn('hm-cap hw-caption hw-ink', className)}>
      <span className="hw-caption-time">{time}</span>
      {source || null}
      <Stamp
        state="printed"
        alt={alt}
        style={{ transform: `rotate(${stamp}deg)` }}
      />
    </Tag>
  );
}

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
  const [fed, ...torn] = todays.slice(0, SHOWN);
  const more = Math.max(0, todays.length - SHOWN);
  // Every job read was today's, so there can be more than were read
  const capped = jobs.length === LIST_LIMIT && todays.length === jobs.length;

  const labels = jobSourceLabels(pairs);
  const slips = pairs.flatMap(({ module, record }) =>
    record ? [{ module, record }] : [],
  );

  const seen = printer.lastSeenAt ? ago(printer.lastSeenAt, now) : null;
  const seenValue = seen ? Math.min(seen.value, 99) : 0;
  const unitStyle = fed
    ? ({ '--hm-slip-h': `${PAPER_Y + printHeight(fed)}px` } as CSSProperties)
    : undefined;

  return (
    <div className="hm-page">
      <div className={cn('hm-desk', torn.length === 0 && 'hm-desk--bare')}>
        <header className="hm-head">
          <h1 className="hm-title hw-ink">Today</h1>
          <span className="hm-date hw-ink">{dateLabel(now, tz)}</span>
        </header>

        <Body
          as="aside"
          aria-label="Printer"
          className="hm-unit"
          style={unitStyle}
        >
          <div className="hm-feedrow">
            <Platen className="hm-platen">
              {fed ? (
                <Slip
                  tear="top"
                  src={jobImageSrc(fed)}
                  alt={`${receiptAlt(fed)}, still in the printer`}
                  imageWidth={fed.width || 576}
                  imageHeight={fed.height}
                  loading="eager"
                  className={cn((fed.height ?? 0) > TEAR_AT && 'hm-long')}
                />
              ) : null}
            </Platen>
          </div>
          {fed ? (
            <Caption
              job={fed}
              source={sourceLabel(labels, fed.source)}
              tz={tz}
              stamp={FED_STAMP}
              alt={false}
              as="p"
              className="hm-cap--fed"
            />
          ) : (
            <Note className="hm-cap--fed">Nothing printed today.</Note>
          )}

          <Plate
            as="section"
            aria-labelledby="hm-printer"
            className="hm-plate--printer"
          >
            <div className="hm-top">
              <PageName as="h2" id="hm-printer" className="hm-name">
                {printer.name ?? 'No printer yet'}
              </PageName>
              {printer.name ? (
                <Lamp state={printer.state} className="hm-lamp">
                  {printerStateText(printer.state)}
                </Lamp>
              ) : null}
            </div>
            <div className="hm-seen">
              {!printer.name ? (
                <Link href="/printer" className="pk-note hm-link">
                  Add a printer
                </Link>
              ) : seen ? (
                <>
                  <Engraved>Last seen</Engraved>
                  <CounterWindow
                    className="hm-seen-counter"
                    value={String(seenValue).padStart(2, '0')}
                    label={`${seen.value} ${SEEN_WORD[seen.unit]}${seen.value === 1 ? '' : 's'} ago`}
                    legend={SEEN_UNIT[seen.unit]}
                  />
                </>
              ) : (
                <Note>Not seen yet</Note>
              )}
              {printer.queued > 0 ? (
                <Link
                  href="/queue"
                  className="pk-note pk-note--red hm-link hm-waiting"
                >
                  {printer.queued} waiting
                </Link>
              ) : null}
            </div>
          </Plate>

          <Plate
            as="section"
            seam
            aria-label="Slips"
            className="hm-plate--slips"
          >
            <Rows>
              {slips.map(({ module, record }) => {
                const title = module.meta?.title || module.id;
                return (
                  <Row key={module.id}>
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
            </Rows>
          </Plate>
        </Body>

        {torn.length ? (
          <section aria-label="Earlier today" className="hm-prints">
            {torn.map((j, i) => {
              const lie = LIE[i];
              return (
                <figure key={j.id} className="hm-item">
                  <div
                    className="hm-lie"
                    style={{
                      rotate: `${lie.rot}deg`,
                      translate: `${lie.x}px ${lie.y}px`,
                    }}
                  >
                    <Slip
                      as="div"
                      tear="none"
                      src={jobImageSrc(j)}
                      alt={receiptAlt(j)}
                      imageWidth={j.width || 576}
                      imageHeight={j.height}
                      loading="lazy"
                      className={cn(
                        `hm-cut-${i + 1}`,
                        (j.height ?? 0) > TEAR_AT && 'hm-long',
                      )}
                    />
                  </div>
                  <Caption
                    job={j}
                    source={sourceLabel(labels, j.source)}
                    tz={tz}
                    stamp={lie.stamp}
                    alt={i % 2 === 0}
                  />
                </figure>
              );
            })}
            {more > 0 ? (
              <Link href="/history" className="hw-link hw-ink hm-more">
                {more}
                {capped ? '+' : ''} more today
              </Link>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
