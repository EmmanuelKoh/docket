// Photo: print a picture, dithered like everything else (design spec:
// pages, Photo). One camera body: the screen shows what will print, the
// adjustments sit beside it, and the lower plate holds the caption, the
// Capture release and the key well. Markup in components/photo-tool.tsx,
// behavior in components/photo-engine.js (verbatim from the legacy page:
// it holds the calibrated tone curve), styles in ./photo-tool.css.
//
// Reads: the printer for the lamp (shared with the nav unit's printer
// line through React cache). Everything else runs in the browser.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { printerStateText, printerSummary } from '@/app/_lib/printer-data';
import { Lamp } from '@/components/hardware/kit/led';
import { PhotoTool } from '@/components/photo-tool';
import './photo-tool.css';

export const metadata: Metadata = { title: 'Photo' };

export default async function PhotoPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  // the lamp only: a failed read leaves it out rather than the page
  const printer = await printerSummary(caller).catch((err) => {
    console.error('[photo printer]', err);
    return null;
  });

  return (
    <PhotoTool
      lamp={
        printer ? (
          <Lamp
            state={printer.name ? printer.state : 'offline'}
            className="ph-lamp"
          >
            {printer.name ? printerStateText(printer.state) : 'No printer'}
          </Lamp>
        ) : null
      }
    />
  );
}
