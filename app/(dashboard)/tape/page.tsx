// Tape — duduk transcription onto receipt tape. A full-width workbench
// (see components/content-column.tsx): mic in, note events out, and a
// scrolling preview of the EXACT raster rows the printer would receive,
// shown in reading orientation (staff horizontal, time left to right).
// The tool lives in components/tape/ (React controls over a zustand
// store, an imperative canvas island, and the take document); styles in
// ./tape-tool.css, on the hardware kit. The paper strip uses the kit's
// paper tokens, so the page loads paper.css.

import type { Metadata } from 'next';
import '@/components/hardware/paper.css';
import { PageTitle } from '@/components/hardware/page-title';
import { TapeTool } from '@/components/tape/tape-tool';
import './tape-tool.css';

export const metadata: Metadata = { title: 'Tape' };

export default function TapePage() {
  return (
    <>
      <PageTitle className="mb-7">Tape</PageTitle>
      <TapeTool />
    </>
  );
}
