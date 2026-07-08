// Studio — the template editor. A full-bleed workbench (see
// components/content-column.tsx): the sidebar collapses on entry and the
// breadcrumb returns to Recipes. The editor itself is
// components/studio-editor.tsx; useSearchParams (the ?template= / ?new=1
// contract) requires the Suspense boundary.

import { Suspense } from 'react';
import { BackLink } from '@/components/back-link';
import { StudioEditor } from '@/components/studio-editor';
import './studio.css';

export default function StudioPage() {
  return (
    <div className="space-y-4">
      <div>
        <BackLink fallback="/recipes" />
        <div className="mt-1 flex items-baseline gap-3">
          <h1 className="text-base font-medium text-ink">Studio</h1>
          <p className="text-xs text-ink-muted">
            Edit a template and preview it.
          </p>
        </div>
      </div>
      <Suspense>
        <StudioEditor />
      </Suspense>
    </div>
  );
}
