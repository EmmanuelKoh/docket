// Photo — print a picture, dithered like everything else. The tool is a
// client-side workbench: markup in components/photo-tool.tsx, behavior in
// components/photo-engine.js (verbatim from the legacy page — it holds
// the calibrated tone curve), styles in ./photo-tool.css.

import { PhotoTool } from '@/components/photo-tool';
import './photo-tool.css';

export default function PhotoPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-medium text-ink">Photo</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          Print a photo on receipt paper.
        </p>
      </div>
      <div className="rounded-md border-[0.5px] border-border bg-raised p-4 sm:p-5">
        <PhotoTool />
      </div>
    </div>
  );
}
