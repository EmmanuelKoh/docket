// Slips: everything the printer can produce, as one machine (design spec:
// pages, Slips). The head plate carries the engraved name and the printer
// lamp; the deck plate under it the counters (all slips, and those
// switched on) and the New template key, which opens the Studio blank.
// Then one numbered plate per category, a ruled row per slip: a window in
// the plate showing the top of its receipt, the engraved name and what
// makes it print (or when a template was last saved), and for a slip that
// runs by itself (a plugin) its switch. The name is the link; it covers
// the row, and the switch sits above it, outside the link. Thumbnails
// load from a versioned URL (slip.thumb), so a revisit paints them from
// the browser cache.

import './slips.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { groupByCategory, listSlips, type Slip } from '@/app/_lib/slip-data';
import { dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Note, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp } from '@/components/hardware/kit/led';
import { Row, Rows } from '@/components/hardware/kit/sheet';
import { SlipSwitch } from '@/components/slip-switch';
import { slipsRegister } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Slips' };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Plate numbers and drums: "01", "02"
const two = (n: number) => String(n).padStart(2, '0');

// "Edited today", "Edited yesterday", "Edited Tue 13 Oct"
function editedLabel(at: number, tz: string, now: number) {
  const day = dayLabel(at, tz, now);
  return `Edited ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

function SlipRow({ slip, tz, now }: { slip: Slip; tz: string; now: number }) {
  const system = slip.kind === 'system';
  const sub = system
    ? slip.runLabel
    : slip.editedAt
      ? editedLabel(slip.editedAt, tz, now)
      : '';
  return (
    <Row className="sl-row">
      {/* the top of the receipt, seen through a window in the plate */}
      <span className="pk-window sl-window" aria-hidden="true">
        <span className="sl-paper">
          {slip.thumb ? (
            <img src={slip.thumb} alt="" loading="lazy" decoding="async" />
          ) : null}
        </span>
      </span>
      <span className="sl-row-text">
        <Link
          href={`/slips/${encodeURIComponent(slip.slug)}`}
          className="sl-row-link"
        >
          <span className="pk-engr">{slip.title}</span>
        </Link>
        {sub ? (
          <span className="pk-engr pk-engr--soft pk-row-sub">{sub}</span>
        ) : null}
        {slip.description ? (
          <Note as="span" className="sl-row-note">
            {slip.description}
          </Note>
        ) : null}
      </span>
      {system ? (
        <SlipSwitch
          id={slip.slug}
          title={slip.title}
          enabled={!!slip.enabled}
          className="sl-row-ctl"
        />
      ) : null}
    </Row>
  );
}

export default async function SlipsPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  await slipsRegister(caller); // a new owner's plugins and their templates
  const [slips, tz, printer] = await Promise.all([
    listSlips(caller),
    viewerTimeZone(),
    printerSummary(caller).catch(() => null),
  ]);
  const groups = groupByCategory(slips);
  const on = slips.filter((s) => s.kind === 'system' && s.enabled).length;
  const now = Date.now();

  return (
    <Body as="section" aria-labelledby="slips-name" className="sl-unit">
      <Plate head>
        <PageName id="slips-name">Slips</PageName>
        {printer?.name ? (
          <Lamp state={printer.state}>{printerStateText(printer.state)}</Lamp>
        ) : null}
      </Plate>

      <Plate seam className="sl-deck">
        <div className="sl-counts">
          <CounterWindow
            value={two(slips.length)}
            label={`${slips.length} ${slips.length === 1 ? 'slip' : 'slips'}`}
            legend="Slips"
          />
          <CounterWindow value={two(on)} label={`${on} on`} legend="On" />
        </div>
        <KeyWell label="Slips">
          <Key legend="New template" width={132} href="/studio?new=1" />
        </KeyWell>
      </Plate>

      {groups.map((group, i) => (
        <Plate
          key={group.category}
          seam
          as="section"
          aria-labelledby={`slips-${group.category}`}
        >
          <h2 id={`slips-${group.category}`} className="sl-plate-name">
            <PlateTitle number={two(i + 1)}>
              <span className="pk-engr">{sentence(group.category)}</span>
            </PlateTitle>
          </h2>
          <Rows
            ruled
            className={
              group.slips.length > 3 &&
              group.slips.every((s) => s.kind === 'template')
                ? 'sl-rows-2'
                : undefined
            }
          >
            {group.slips.map((slip) => (
              <SlipRow key={slip.slug} slip={slip} tz={tz} now={now} />
            ))}
          </Rows>
        </Plate>
      ))}

      {groups.length === 0 ? (
        <Plate seam>
          <Note>No slips yet. Make a template in Studio.</Note>
        </Plate>
      ) : null}
    </Body>
  );
}
