// Printer — the device page. Status per the 90-second rule (the ESP32
// polls /next constantly and its "last seen" write is throttled to once
// per 60s), then the running configuration from config.js and pointers to
// the hardware docs. Read-only: the printer is configured by env vars and
// firmware, not from the dashboard.

import { redirect } from 'next/navigation';
import { sessionOwner } from '@/app/_lib/dashboard-session';
import {
  HEARTBEAT_SECONDS,
  JOB_CAP,
  PRINT_WIDTH,
  STORE_DRIVER,
} from '@/config.js';
import { listDevices } from '@/lib/devices.js';
import { getState } from '@/lib/state-store.js';
import pkg from '@/package.json';
import { agoText } from '../../_lib/format';
import { ClaimDeviceForm, RevokeDeviceButton } from './devices-client';

export default async function PrinterPage() {
  const owner = await sessionOwner();
  if (!owner) redirect('/login');
  const paired = await listDevices(owner);
  const device = await getState(owner, 'device');
  const lastSeen = device?.lastSeenAt as string | undefined;
  const online =
    !!lastSeen && Date.now() - new Date(lastSeen).getTime() <= 90 * 1000;

  const rows = [
    {
      label: 'device',
      value: lastSeen ? `seen ${agoText(lastSeen)}` : 'no device contact yet',
    },
    { label: 'store', value: STORE_DRIVER },
    { label: 'tick', value: `${HEARTBEAT_SECONDS}s` },
    { label: 'print width', value: `${PRINT_WIDTH} dots` },
    { label: 'job cap', value: String(JOB_CAP) },
    { label: 'version', value: `v${pkg.version}` },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-medium text-ink">Printer</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          Status and settings of the connected printer.
        </p>
      </div>

      <section className="rounded-md border-[0.5px] border-border bg-raised px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${online ? 'bg-ink' : 'bg-ink-faint'}`}
          />
          <span className="font-mono text-[13px] text-ink">
            {online ? 'online' : 'offline'}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3"
            >
              <span className="text-[13px] font-semibold text-ink">
                {r.label}
              </span>
              <span className="font-mono text-[12.5px] text-ink-muted">
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-ink">Devices</h2>
        <ul className="mt-3">
          {paired.map(
            (d: { id: string; name: string | null; pairedAt: Date | null }) => (
              <li
                key={d.id}
                className="flex items-baseline gap-2 border-b-[0.5px] border-border py-2"
              >
                <span className="text-sm font-medium text-ink">
                  {d.name || 'printer'}
                </span>
                <span className="leader" aria-hidden />
                <span className="text-xs text-ink-faint">
                  {d.pairedAt
                    ? `paired ${agoText(d.pairedAt.toISOString())}`
                    : 'pairing…'}
                </span>
                <RevokeDeviceButton id={d.id} />
              </li>
            ),
          )}
          {paired.length === 0 ? (
            <li className="py-2 text-xs text-ink-faint">
              No paired devices. A new printer prints its pairing code on boot —
              enter it below.
            </li>
          ) : null}
        </ul>
        <div className="mt-4">
          <ClaimDeviceForm />
        </div>
      </section>
    </div>
  );
}
