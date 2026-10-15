// Printer (design spec: pages, Printer). Left: the Status module (the
// printer the account prints to: LED and state, last seen, jobs waiting
// and a Queue link while anything waits or prints, paper width, version)
// and the Printers module (each printer you own or share, with its
// keys). Right: Add a printer, the one form for a pairing code or a
// share code.
//
// One printers.overview read, shared with the panel's printer line
// through React cache (app/_lib/printer-data.ts). Presence is read from
// the printer's primary owner's slot, so a shared printer shows online
// for its members too. While a pairing is pending the page refreshes
// every 3s (PairingWatcher).

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import {
  printerOverview,
  printerStateText,
  printerSummary,
} from '@/app/_lib/printer-data';
import { ago, agoLabel } from '@/app/_lib/time';
import { Led } from '@/components/hardware/led';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { Row } from '@/components/hardware/row';
import { Note } from '@/components/hardware/text';
import { cn } from '@/components/utils';
import { PRINT_WIDTH } from '@/config.js';
import pkg from '@/package.json';
import {
  ClaimDeviceForm,
  DeviceRow,
  type DeviceRowData,
  PairingWatcher,
} from './devices-client';

export const metadata: Metadata = { title: 'Printer' };

function rowData(
  d: Awaited<ReturnType<typeof printerOverview>>['devices'][number],
  now: number,
): DeviceRowData {
  const sub = !d.pairedAt
    ? 'Pairing'
    : d.role === 'member'
      ? 'Shared with you'
      : `Paired ${agoLabel(d.pairedAt, now)} ago`;
  return {
    id: d.id,
    name: d.name?.trim() || 'Printer',
    sub,
    role: d.role,
    shareCode: d.shareCode ?? null,
    members: d.members ?? [],
  };
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

  return (
    <>
      <PageTitle>Printer</PageTitle>
      {pairingPending ? <PairingWatcher /> : null}

      <div className="flex flex-wrap items-start gap-x-[52px] gap-y-[30px]">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-[30px]">
          <Module number="01" title="Status" bodyClassName="gap-2">
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
                <Note className="max-w-[52ch]">
                  Turn the printer on: it prints a pairing code. Enter the code
                  under Add a printer.
                </Note>
              </>
            )}
            {printer.queued > 0 || printer.inflight > 0 ? (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {printer.queued > 0 ? (
                  <span className="font-semibold text-red">
                    {printer.queued} waiting
                  </span>
                ) : null}
                <Link href="/queue" className="hw-link">
                  Queue
                </Link>
              </div>
            ) : null}
            <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5">
              <dt className="hw-label">Paper width</dt>
              <dd className="hw-mono m-0 text-sm">
                80 mm · {PRINT_WIDTH} dots
              </dd>
              <dt className="hw-label">Version</dt>
              <dd className="hw-mono m-0 text-sm">v{pkg.version}</dd>
            </dl>
          </Module>

          <Module number="02" title="Printers" flush>
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
          </Module>
        </div>

        <Module
          number="03"
          title="Add a printer"
          className="min-w-[280px] flex-[1_1_320px] max-[400px]:min-w-0"
        >
          <ClaimDeviceForm />
        </Module>
      </div>
    </>
  );
}
