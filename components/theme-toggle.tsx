'use client';

// Theme toggle — moon icon in light mode, sun in dark (spec). Same
// mechanism as the legacy dashboard: data-theme="dark" on <html>,
// persisted under the localStorage key "docket-theme". The initial value
// is read after mount so server HTML never disagrees with the client.

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('docket-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('docket-theme', 'light');
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-ink-faint transition-colors hover:text-ink"
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
