'use client';

// The Back key: a Leica push key that returns to wherever the user came
// from (the slip page whose "Open in Studio" was pressed, Home, the Slips
// index...). Falls back to a fixed route when there is no history to
// return to (opened in a fresh tab, deep link). It sits in a body's head
// plate, never loose on the mat.

import { useRouter } from 'next/navigation';
import { LeicaKey } from '@/components/hardware/kit/controls';

export function BackLink({
  fallback,
  label = 'Back',
  className,
}: {
  fallback: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <LeicaKey
      className={className}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      {label}
    </LeicaKey>
  );
}
