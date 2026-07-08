'use client';

// The content column. Regular pages get the spec's centered 1120px
// column; the Studio is a workbench and gets the full width (its editors
// need the room — the sidebar also auto-collapses there, see
// studio-editor.tsx). One component so the layout stays single-purpose.

import { usePathname } from 'next/navigation';

export function ContentColumn({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname === '/studio';
  return (
    <main
      className={
        fullBleed
          ? 'w-full px-4 py-6 sm:px-6'
          : 'mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-12'
      }
    >
      {children}
    </main>
  );
}
