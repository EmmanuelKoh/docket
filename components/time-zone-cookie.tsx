'use client';

// Stores the browser's time zone in the "tz" cookie, so the server can
// format times for this viewer (app/_lib/time.ts). It renders nothing.
// When the cookie is missing or out of date (first visit, or travel), it
// writes the cookie and refreshes the page once, so the server renders
// the times again in the right zone.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const NAME = 'tz';

export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;
    const stored = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${NAME}=`))
      ?.slice(NAME.length + 1);
    if (stored && decodeURIComponent(stored) === zone) return;
    // biome-ignore lint/suspicious/noDocumentCookie: one plain preference cookie; the Cookie Store API is not in every browser
    document.cookie = `${NAME}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);
  return null;
}
