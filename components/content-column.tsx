'use client';

// The content column: the only <main>, and the skip link's target.
// Regular pages get the E page padding (40px 48px 72px on a wide screen,
// 16px gutters on a phone) and a width cap. The Studio and the Tape tool
// are workbenches and get the full width with tighter padding: editors
// and the sideways-scrolling tape need the room.

import { usePathname } from 'next/navigation';

export const MAIN_ID = 'main';

export function ContentColumn({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname === '/studio' || pathname === '/tape';
  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className={
        fullBleed
          ? 'hw-main px-4 pt-6 pb-12 outline-none sm:px-6 min-[876px]:pt-8'
          : 'hw-main px-4 pt-6 pb-16 outline-none sm:px-8 sm:pt-8 min-[876px]:px-12 min-[876px]:pt-10 min-[876px]:pb-[72px]'
      }
    >
      {fullBleed ? children : <div className="max-w-[1180px]">{children}</div>}
    </main>
  );
}
