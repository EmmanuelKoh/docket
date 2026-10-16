'use client';

// The content column: the only <main>, and the skip link's target.
// Regular pages get the E page padding (40px 48px 72px on a wide screen,
// 16px gutters on a phone) and a width cap. The Tape tool is a workbench
// and gets the full width with tighter padding: the sideways-scrolling
// tape needs the room. The Studio is one body in the regular column; its
// paper window reaches up through the column's top padding
// (app/(dashboard)/studio/studio.css reads it). The wide breakpoint is
// 876px written in rem (54.75rem): Tailwind orders a px breakpoint before
// sm (40rem), so sm's padding would win over it.

import { usePathname } from 'next/navigation';

export const MAIN_ID = 'main';

export function ContentColumn({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname === '/tape';
  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className={
        fullBleed
          ? 'hw-main px-4 pt-6 pb-12 outline-none sm:px-6 min-[876px]:pt-8'
          : 'hw-main px-4 pt-6 pb-16 outline-none sm:px-8 sm:pt-8 min-[54.75rem]:px-12 min-[54.75rem]:pt-10 min-[54.75rem]:pb-[72px]'
      }
    >
      {fullBleed ? children : <div className="max-w-[1180px]">{children}</div>}
    </main>
  );
}
