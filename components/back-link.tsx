'use client';

// A breadcrumb that goes back to wherever the user actually came from
// (the recipe page whose "Open in Studio" was clicked, the index's "New
// template", a History link...). Falls back to a fixed route when there
// is no history to return to (opened in a fresh tab, deep link).

import { useRouter } from 'next/navigation';

export function BackLink({
  fallback,
  label = '← back',
}: {
  fallback: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="text-xs text-ink-faint transition-colors hover:text-ink"
    >
      {label}
    </button>
  );
}
