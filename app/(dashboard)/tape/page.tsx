// Tape — duduk transcription onto receipt tape. A full-width workbench
// (see components/content-column.tsx): mic in, note events out, and a
// scrolling preview of the EXACT raster rows the printer would receive,
// shown in reading orientation (staff horizontal, time left to right).
// The tool lives in components/tape/ (React controls over a zustand
// store, an imperative canvas island, and the take document); styles in
// ./tape-tool.css, on the parts kit (app/kit.css). The printer lamp on
// the head plate streams in Suspense, so the page waits on no store read.

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCaller } from '@/app/_lib/caller';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { Lamp } from '@/components/hardware/kit/led';
import { TapeTool } from '@/components/tape/tape-tool';
import './tape-tool.css';

export const metadata: Metadata = { title: 'Tape' };

// The printer's state on the head plate, from the reads the nav's printer
// line already makes (React cache): no extra store read. A failed read or
// an account with no printer shows no lamp.
async function PrinterLamp() {
  const caller = await getCaller();
  if (!caller) return null;
  try {
    const printer = await printerSummary(caller);
    if (!printer.name) return null;
    return <Lamp state={printer.state}>{printerStateText(printer.state)}</Lamp>;
  } catch {
    return null;
  }
}

export default function TapePage() {
  return (
    <TapeTool
      lamp={
        <Suspense fallback={null}>
          <PrinterLamp />
        </Suspense>
      }
    />
  );
}
