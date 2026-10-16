// The nav unit's printer line: the LED, and the printer's name and its
// state engraved beside it. The layout streams it in Suspense, so no page waits
// on it. It costs one printers.overview read (Postgres) and one queue size
// read (Redis) per page load, both shared with the page through React
// cache (app/_lib/printer-data.ts). A failed read shows nothing rather
// than breaking the shell. Layouts do not render again on client-side
// navigation, so the line is as fresh as the last full load or refresh.

import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { Led } from '@/components/hardware/kit/led';
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
      <>
        <Led state="offline" />
        <span className="pk-nav-printer">
          <span className="pk-engr">No printer</span>
        </span>
      </>
    );
  }
  return (
    <>
      <Led state={printer.state} />
      <span className="pk-nav-printer">
        <span className="pk-engr">{printer.name}</span>
        <span
          className={
            printer.state === 'printing'
              ? 'pk-engr pk-engr--red'
              : 'pk-engr pk-engr--soft'
          }
        >
          {printerStateText(printer.state)}
        </span>
      </span>
    </>
  );
}
