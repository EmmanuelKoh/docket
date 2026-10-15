// Photo: print a picture, dithered like everything else. The tool is a
// client-side workbench: markup in components/photo-tool.tsx, behavior in
// components/photo-engine.js (verbatim from the legacy page: it holds the
// calibrated tone curve), styles in ./photo-tool.css.

import type { Metadata } from 'next';
import { PageTitle } from '@/components/hardware/page-title';
import { PhotoTool } from '@/components/photo-tool';
import './photo-tool.css';

export const metadata: Metadata = { title: 'Photo' };

export default function PhotoPage() {
  return (
    <>
      <PageTitle>Photo</PageTitle>
      <PhotoTool />
    </>
  );
}
