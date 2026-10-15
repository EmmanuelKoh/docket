// The panel's printer line: LED, printer name and state. The layout
// streams it in Suspense, so no page waits on it. It costs one
// printers.overview read (Postgres) and one queue size read (Redis) per
// page load, both shared with the page through React cache
// (app/_lib/printer-data.ts). A failed read shows nothing rather than
// breaking the shell. Layouts do not render again on client-side
// navigation, so the line is as fresh as the last full load or refresh.

import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { Led } from '@/components/hardware/led';
import type { Caller } from '@/lib/ops/caller.js';

export async function PrinterStatus({ caller }: { caller: Caller }) {
  let printer: Awaited<ReturnType<typeof printerSummary>>;
  try {
    printer = await printerSummary(caller);
  } catch (err) {
    console.error('[printer status]', err);
    return null;
  }
  if (!printer.name) {
    return (
      <span className="hw-side-status-text">
        <Led state="offline" />
        <span>No printer</span>
      </span>
    );
  }
  return (
    <span className="hw-side-status-text">
      <Led state={printer.state} />
      <span className="flex min-w-0 gap-[0.3em]">
        <span className="truncate">{printer.name}</span>
        <span aria-hidden="true">·</span>
        <span
          className={
            printer.state === 'printing' ? 'shrink-0 text-red' : 'shrink-0'
          }
        >
          {printerStateText(printer.state)}
        </span>
      </span>
    </span>
  );
}
