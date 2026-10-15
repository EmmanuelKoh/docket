'use client';

// A link back to wherever the user came from (the slip page whose "Open
// in Studio" was pressed, Home, the Slips index...). Falls back to a
// fixed route when there is no history to return to (opened in a fresh
// tab, deep link). A plain underlined text link with a 44px target.

import { useRouter } from 'next/navigation';
import { cn } from '@/components/utils';

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
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className={cn(
        'hw-link inline-flex min-h-[44px] cursor-pointer items-center border-0 bg-transparent p-0 text-sm',
        className,
      )}
    >
      {label}
    </button>
  );
}
