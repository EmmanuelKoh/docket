'use client';

// The "Dark" switch in the panel. Dark mode is data-theme="dark" on
// <html>, kept in localStorage under "docket-theme"; the inline script in
// app/layout.tsx applies it before the first paint. The switch reads the
// attribute from the page (the server renders it off, and it moves to the
// stored position after hydration), so the server markup never disagrees
// with the client.

import { useSyncExternalStore } from 'react';
import { SlideSwitch } from '@/components/hardware/slide-switch';

const KEY = 'docket-theme';

function subscribe(onChange: () => void) {
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => watcher.disconnect();
}

const isDark = () =>
  document.documentElement.getAttribute('data-theme') === 'dark';

function setDark(dark: boolean) {
  const html = document.documentElement;
  if (dark) html.setAttribute('data-theme', 'dark');
  else html.removeAttribute('data-theme');
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export function ThemeSwitch({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <SlideSwitch
      checked={dark}
      label="Dark"
      onChange={setDark}
      className={className}
    />
  );
}
