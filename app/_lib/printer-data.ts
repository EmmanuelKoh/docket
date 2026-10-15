// app/_lib/printer-data.ts: the printer as the dashboard shows it. One
// printers.overview read per request (React cache), shared by the
// panel's status line and any page that shows the printer (Home, Printer).
// The state comes from that read plus the queue size (jobs.queueSize,
// also cached per request): an online printer that holds a job is
// printing.

import { cache } from 'react';
import type { Caller } from '@/lib/ops/caller.js';
import { printersOverview } from '@/lib/ops/printers.js';
import { queueSize } from './queue-data';

export type PrinterDevice = {
  id: string;
  name: string | null;
  pairedAt: string | null;
  role: 'owner' | 'member';
  primaryOwnerId: string;
  /** owned printers only: a live share code, and who else prints to it */
  shareCode?: string | null;
  members?: { ownerId: string; email: string }[];
};

export type PrinterOverview = {
  devices: PrinterDevice[];
  status: { lastSeenAt: string | null; online: boolean };
};

export const printerOverview = cache(
  (caller: Caller) => printersOverview(caller) as Promise<PrinterOverview>,
);

export type PrinterState = 'online' | 'printing' | 'offline';

export type PrinterSummary = {
  /** null when the account has no printer */
  name: string | null;
  state: PrinterState;
  lastSeenAt: string | null;
  queued: number;
  inflight: number;
};

const STATE_TEXT: Record<PrinterState, string> = {
  online: 'Online',
  printing: 'Printing',
  offline: 'Offline',
};

export const printerStateText = (state: PrinterState) => STATE_TEXT[state];

// The printer whose heartbeat the status reads (printers.status): the
// first listed, as lib/device-presence.js picks it.
export async function printerSummary(caller: Caller): Promise<PrinterSummary> {
  const [{ devices, status }, size] = await Promise.all([
    printerOverview(caller),
    queueSize(caller),
  ]);
  const [first] = devices;
  // A job held by a printer that stopped answering is not printing: its
  // lease runs out and it goes back to the queue.
  const state: PrinterState = !status.online
    ? 'offline'
    : size.inflight > 0
      ? 'printing'
      : 'online';
  return {
    name: first ? first.name?.trim() || 'Printer' : null,
    state: first ? state : 'offline',
    lastSeenAt: status.lastSeenAt,
    queued: size.queued,
    inflight: size.inflight,
  };
}
