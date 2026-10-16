// Printer (design spec: pages, Printer): the printer's own front panel,
// one body. The head plate engraves the page name with the printer's lamp.
// The status plate: the printer the account prints to (the first listed),
// its name engraved, when it was last seen on a counter with its unit,
// paper width and version engraved as data, and the jobs waiting on a
// counter with the Queue key. Plate 01 holds the printers as ruled rows
// with their compact keys; plate 02 the pairing code and name fields and
// the Pair key, the one form for a pairing code or a share code.
//
// One printers.overview read, shared with the nav's printer line through
// React cache (app/_lib/printer-data.ts). Presence is read from the
// printer's primary owner's slot, so a shared printer shows online for its
// members too. While a pairing is pending the page refreshes every 3s
// (PairingWatcher).

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import {
  printerOverview,
  printerStateText,
  printerSummary,
} from '@/app/_lib/printer-data';
import { ago } from '@/app/_lib/time';
import { Body, Plate, PlateTitle } from '@/components/hardware/kit/body';
import { CounterWindow } from '@/components/hardware/kit/counter-window';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp } from '@/components/hardware/kit/led';
import { Row, Rows } from '@/components/hardware/kit/sheet';
import { PRINT_WIDTH } from '@/config.js';
import pkg from '@/package.json';
import {
  ClaimDeviceForm,
  DeviceRow,
  type DeviceRowData,
  PairingWatcher,
} from './devices-client';

export const metadata: Metadata = { title: 'Printer' };

type Unit = ReturnType<typeof ago>['unit'];

// The unit engraved after the counter, and the words a screen reader hears.
// (Home's printer writes it the same way.)
const UNIT: Record<Unit, { legend: string; word: string; short: string }> = {
  s: { legend: 'Sec', word: 'second', short: 'sec' },
  m: { legend: 'Min', word: 'minute', short: 'min' },
  h: { legend: 'Hr', word: 'hour', short: 'hr' },
  d: { legend: 'Day', word: 'day', short: 'days' },
};

/** "39 min", "3 days": a row's line, engraved in capitals. */
function agoText(when: string, now: number) {
  const a = ago(when, now);
  return `${a.value} ${a.unit === 'd' && a.value === 1 ? 'day' : UNIT[a.unit].short}`;
}

function rowData(
  d: Awaited<ReturnType<typeof printerOverview>>['devices'][number],
  now: number,
): DeviceRowData {
  const sub = !d.pairedAt
    ? 'Pairing'
    : d.role === 'member'
      ? 'Shared with you'
      : `Paired ${agoText(d.pairedAt, now)} ago`;
  return {
    id: d.id,
    name: d.name?.trim() || 'Printer',
    sub,
    role: d.role,
    shareCode: d.shareCode ?? null,
    members: d.members ?? [],
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// A plate's numbered name, with an engraved line running on to the plate's
// right edge (a panel's section legend).
function PlateHeading({
  number,
  id,
  children,
}: {
  number: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="m-0 flex items-center gap-4">
      <PlateTitle number={number}>
        <Engraved>{children}</Engraved>
      </PlateTitle>
      <span
        aria-hidden="true"
        className="h-[1.2px] flex-1 bg-[linear-gradient(var(--pk-rule)_0_0.6px,var(--pk-rule-lip)_0.6px_1.2px)]"
      />
    </h2>
  );
}

export default async function PrinterPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  const [{ devices }, printer] = await Promise.all([
    printerOverview(caller),
    printerSummary(caller),
  ]);
  const now = Date.now();
  const pairingPending = devices.some((d) => d.pairedAt === null);
  const seen = printer.lastSeenAt ? ago(printer.lastSeenAt, now) : null;

  return (
    <>
      {pairingPending ? <PairingWatcher /> : null}
      <Body as="section" aria-labelledby="printer-name">
        <Plate head>
          <PageName id="printer-name">Printer</PageName>
          <Lamp state={printer.state}>{printerStateText(printer.state)}</Lamp>
        </Plate>

        <Plate
          seam
          className="grid items-center gap-x-12 gap-y-7 min-[1000px]:grid-cols-[minmax(0,1fr)_auto_auto]"
        >
          <div className="flex min-w-0 flex-col gap-[18px]">
            {printer.name ? (
              <>
                <Engraved
                  as="h2"
                  className="m-0 text-[14px] leading-[1.2] tracking-[0.22em]"
                >
                  {printer.name}
                </Engraved>
                {seen ? (
                  <span className="flex items-center gap-3">
                    <Engraved aria-hidden="true">Last seen</Engraved>
                    <CounterWindow
                      value={pad2(Math.min(seen.value, 99))}
                      label={`Last seen ${seen.value} ${UNIT[seen.unit].word}${seen.value === 1 ? '' : 's'} ago`}
                      legend={UNIT[seen.unit].legend}
                    />
                  </span>
                ) : (
                  <Note>Not seen yet.</Note>
                )}
              </>
            ) : (
              <>
                <Engraved
                  as="h2"
                  className="m-0 text-[14px] leading-[1.2] tracking-[0.22em]"
                >
                  No printer yet
                </Engraved>
                <Note className="max-w-[48ch]">
                  Turn the printer on: it prints a pairing code. Enter the code
                  under Add a printer.
                </Note>
              </>
            )}
          </div>

          <dl className="m-0 grid grid-cols-[auto_auto] items-center justify-start gap-x-6 min-[1000px]:grid-rows-[17px_36px] min-[1000px]:gap-y-[18px] max-[999px]:gap-y-3.5">
            <Engraved as="dt" tone="soft">
              Paper
            </Engraved>
            <Engraved as="dd" className="m-0 font-mono tracking-[0.08em]">
              80 mm · {PRINT_WIDTH} dots
            </Engraved>
            <Engraved as="dt" tone="soft">
              Version
            </Engraved>
            <Engraved as="dd" className="m-0 font-mono tracking-[0.08em]">
              v{pkg.version}
            </Engraved>
          </dl>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
            <span className="flex items-center gap-3">
              <Engraved aria-hidden="true">Waiting</Engraved>
              <CounterWindow
                value={pad2(printer.queued)}
                label={`${printer.queued} ${printer.queued === 1 ? 'job' : 'jobs'} waiting`}
                legend={printer.queued === 1 ? 'Job' : 'Jobs'}
              />
            </span>
            <KeyWell label="Queue">
              <Key href="/queue" legend="Queue" />
            </KeyWell>
          </div>
        </Plate>

        <Plate seam className="flex flex-col gap-2">
          <PlateHeading number="01">Printers</PlateHeading>
          <Rows ruled>
            {devices.map((d) => (
              <DeviceRow key={d.id} device={rowData(d, now)} />
            ))}
            {devices.length === 0 ? (
              <Row>
                <Note>
                  No printers yet. Enter a pairing code or a share code.
                </Note>
              </Row>
            ) : null}
          </Rows>
        </Plate>

        <Plate seam className="flex flex-col gap-6 pb-[26px]">
          <PlateHeading number="02" id="add-printer">
            Add a printer
          </PlateHeading>
          <ClaimDeviceForm />
        </Plate>
      </Body>
    </>
  );
}
