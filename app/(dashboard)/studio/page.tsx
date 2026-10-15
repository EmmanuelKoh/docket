// Studio: the template editor. A full-width workbench (see
// components/content-column.tsx); Back returns to where you came from
// (a slip's "Open in Studio", Slips' "New template"). The editor itself
// is components/studio-editor.tsx; useSearchParams (the ?template= /
// ?new=1 contract) requires the Suspense boundary.

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/hardware/page-title';
import { StudioEditor } from '@/components/studio-editor';
import './studio.css';

export const metadata: Metadata = { title: 'Studio' };

export default function StudioPage() {
  return (
    <>
      <BackLink fallback="/slips" className="-mt-3 mb-1" />
      <PageTitle className="mb-7">Studio</PageTitle>
      <Suspense>
        <StudioEditor />
      </Suspense>
    </>
  );
}
