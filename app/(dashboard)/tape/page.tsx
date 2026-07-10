// Tape — live duduk transcription onto receipt tape. A full-bleed
// workbench (see components/content-column.tsx): mic in, note events
// out, and a scrolling preview of the EXACT raster rows the printer
// would receive, shown in reading orientation (staff horizontal, time
// left to right). The tool lives in components/tape/ (React controls
// over a zustand store, an imperative canvas island, and the take
// document); styles in ./tape-tool.css.

import { TapeTool } from '@/components/tape/tape-tool';
import './tape-tool.css';

export default function TapePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-medium text-ink">Tape</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          Live transcription — play, tune the detector, print the take.
        </p>
      </div>
      <div className="rounded-md border-[0.5px] border-border bg-raised p-4 sm:p-5">
        <TapeTool />
      </div>
    </div>
  );
}
