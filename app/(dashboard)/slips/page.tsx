// Slips: everything the printer can produce, one module per category
// (design spec: pages, Slips). Each slip is a row: a small receipt
// thumbnail on white, the name (the link to the slip's page), what makes
// it print, and for a slip that runs by itself (a plugin) its switch,
// outside the link. A template slip shows when it was last saved, under a
// shorter thumbnail (the top of its receipt). "New template" opens the Studio blank (a client-side
// Link, like every Studio link). Thumbnails load from a versioned URL
// (slip.thumb), so a revisit paints them from the browser cache.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { groupByCategory, listSlips, type Slip } from '@/app/_lib/slip-data';
import { dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row } from '@/components/hardware/row';
import { Note } from '@/components/hardware/text';
import { SlipSwitch } from '@/components/slip-switch';
import { cn } from '@/components/utils';
import { slipsRegister } from '@/lib/ops/slips.js';

export const metadata: Metadata = { title: 'Slips' };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Plate numbers in reading order: "01", "02"
const plate = (i: number) => String(i + 1).padStart(2, '0');

// "Edited today", "Edited yesterday", "Edited Tue 13 Oct"
function editedLabel(at: number, tz: string, now: number) {
  const day = dayLabel(at, tz, now);
  return `Edited ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

function SlipRow({ slip, tz, now }: { slip: Slip; tz: string; now: number }) {
  const href = `/slips/${encodeURIComponent(slip.slug)}`;
  const system = slip.kind === 'system';
  return (
    <Row
      off={system && !slip.enabled}
      className="items-start justify-start gap-4 max-sm:flex-wrap"
    >
      {/* the name is the link for keyboards and screen readers; the
          thumbnail is a second way in for a pointer */}
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className={cn(
          'hw-thumb w-[88px] sm:w-[112px]',
          system ? 'max-h-[150px]' : 'max-h-[84px]',
        )}
      >
        {slip.thumb ? (
          <img src={slip.thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="block h-[60px]" />
        )}
      </Link>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <Link href={href} className="hw-link self-start">
          {slip.title}
        </Link>
        {system ? <span className="hw-row-sub">{slip.runLabel}</span> : null}
        {!system && slip.editedAt ? (
          <span className="hw-row-sub">
            {editedLabel(slip.editedAt, tz, now)}
          </span>
        ) : null}
        {slip.description ? (
          <Note className="mt-1.5 line-clamp-2 max-w-[60ch]">
            {slip.description}
          </Note>
        ) : null}
      </div>
      {system ? (
        <SlipSwitch
          id={slip.slug}
          title={slip.title}
          enabled={!!slip.enabled}
          className="max-sm:ml-auto"
        />
      ) : null}
    </Row>
  );
}

export default async function SlipsPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  await slipsRegister(caller); // a new owner's plugins and their templates
  const [slips, tz] = await Promise.all([listSlips(caller), viewerTimeZone()]);
  const groups = groupByCategory(slips);
  const now = Date.now();

  return (
    <>
      <PageTitle
        actions={
          <KeyGroup>
            <PushKey href="/studio?new=1">New template</PushKey>
          </KeyGroup>
        }
      >
        Slips
      </PageTitle>

      <div className="flex max-w-[860px] flex-col gap-[30px]">
        {groups.map((group, i) => (
          <Module
            key={group.category}
            number={plate(i)}
            title={sentence(group.category)}
            flush
          >
            {group.slips.map((slip) => (
              <SlipRow key={slip.slug} slip={slip} tz={tz} now={now} />
            ))}
          </Module>
        ))}
        {groups.length === 0 ? (
          <Module number="01" title="Slips">
            <Note>No slips yet. Make a template in Studio.</Note>
          </Module>
        ) : null}
      </div>
    </>
  );
}
