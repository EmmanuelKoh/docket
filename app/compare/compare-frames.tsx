'use client';

// The two frames. Dark is html[data-theme="dark"], so one document shows
// one theme: each frame gets its theme stamped on its own <html> when it
// loads (the frames share localStorage, so the stored theme cannot tell
// them apart). Width 0 fits both frames side by side in the window.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const PAGES = [
  '/kit',
  '/',
  '/studio',
  '/photo',
  '/history',
  '/slips',
  '/printer',
  '/queue',
  '/users',
  '/tape',
];
const WIDTHS = [
  { w: 0, name: 'Fit' },
  { w: 390, name: 'Phone 390' },
  { w: 768, name: 'Tablet 768' },
  { w: 1280, name: 'Desktop 1280' },
];

// A frame can finish loading before this page hydrates, and React then
// never sees its load event: stamp on mount as well as on every load.
function Frame({
  page,
  theme,
  width,
}: {
  page: string;
  theme: 'light' | 'dark';
  width: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stamp = () => {
      const html = el.contentDocument?.documentElement;
      if (!html) return;
      if (theme === 'dark') html.setAttribute('data-theme', 'dark');
      else html.removeAttribute('data-theme');
    };
    stamp();
    el.addEventListener('load', stamp);
    return () => el.removeEventListener('load', stamp);
  }, [theme]);
  return (
    <iframe
      ref={ref}
      title={`${page} in ${theme}`}
      src={page}
      className="min-h-[calc(100dvh-80px)] flex-1 border border-current/20"
      style={width ? { width: `${width}px`, flex: 'none' } : undefined}
    />
  );
}

export function CompareFrames({
  page,
  width,
}: {
  page: string;
  width: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(page);
  const go = (p: string, w = width) =>
    router.replace(
      `/compare?page=${encodeURIComponent(p)}${w ? `&w=${w}` : ''}`,
    );

  return (
    <div className="flex min-h-dvh flex-col gap-3 p-3 text-[14px]">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
      >
        <input
          aria-label="Page"
          className="w-[220px] border border-current/30 bg-transparent px-2 py-1 font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {PAGES.map((p) => (
          <button
            key={p}
            type="button"
            className={`px-2 py-1 ${p === page ? 'underline' : 'opacity-70'}`}
            onClick={() => {
              setDraft(p);
              go(p);
            }}
          >
            {p}
          </button>
        ))}
        <span className="mx-2 opacity-40">|</span>
        {WIDTHS.map(({ w, name }) => (
          <button
            key={name}
            type="button"
            className={`px-2 py-1 ${w === width ? 'underline' : 'opacity-70'}`}
            onClick={() => go(page, w)}
          >
            {name}
          </button>
        ))}
      </form>
      <div className="flex flex-1 flex-wrap gap-3">
        {(['light', 'dark'] as const).map((theme) => (
          <Frame
            key={`${theme}-${page}`}
            page={page}
            theme={theme}
            width={width}
          />
        ))}
      </div>
    </div>
  );
}
