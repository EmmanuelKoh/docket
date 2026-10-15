'use client';

// The panel: the dashboard's main navigation (design spec: shell). On a
// wide screen it is a column at the left: the DOCKET wordmark with the
// version, the bank of lever keys, then the Dark switch, Sign out and the
// printer line at the foot. At 875px and below it lies across the top:
// wordmark and Dark switch, the keys as one row that scrolls sideways,
// then the printer line and Sign out. The key for the current page stays
// down with its red flag lit (KeyBank reads the URL). The layout passes
// the printer line in as a slot that streams in on its own
// (app/(dashboard)/printer-status.tsx).

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { type BankKey, KeyBank } from '@/components/hardware/key-bank';
import { ThemeSwitch } from '@/components/theme-switch';

const KEYS: readonly BankKey[] = [
  { href: '/', label: 'Home' },
  { href: '/slips', label: 'Slips' },
  { href: '/studio', label: 'Studio' },
  { href: '/photo', label: 'Photo' },
  { href: '/tape', label: 'Tape' },
  { href: '/history', label: 'History' },
  { href: '/printer', label: 'Printer' },
];
const ADMIN_KEYS: readonly BankKey[] = [
  ...KEYS,
  { href: '/users', label: 'Users' },
];

export function AppSidebar({
  status = null,
  isAdmin = false,
  version,
}: {
  /** The printer line: LED, name and state. */
  status?: React.ReactNode;
  isAdmin?: boolean;
  /** Shown beside the wordmark, such as "v0.1.0". */
  version?: string;
}) {
  const pathname = usePathname();
  const bankRef = useRef<HTMLDivElement>(null);

  // When the keys scroll sideways (narrow screens), bring the current
  // key into view: on a phone, History or Printer starts out of sight.
  // It runs again on each page change (pathname).
  useEffect(() => {
    const row = bankRef.current?.querySelector<HTMLElement>('.hw-keybank');
    const key = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !key || row.scrollWidth <= row.clientWidth) return;
    const left = key.offsetLeft - (row.clientWidth - key.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left) });
  }, [pathname]);

  // A key that takes focus while only partly in view scrolls fully into
  // view. The browser scrolls only a key that is out of sight, so a
  // half-hidden key would keep half its focus ring under the plate rim.
  useEffect(() => {
    const bank = bankRef.current;
    if (!bank) return;
    const onFocus = (e: FocusEvent) => {
      (e.target as HTMLElement)
        .closest('.hw-key')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    bank.addEventListener('focusin', onFocus);
    return () => bank.removeEventListener('focusin', onFocus);
  }, []);

  return (
    <nav aria-label="Main" className="hw-panel hw-side">
      <div className="hw-side-brand">
        <span className="hw-wordmark">DOCKET</span>
        {version ? (
          <span className="hw-side-version hw-mono">{version}</span>
        ) : null}
      </div>
      <div className="hw-side-bank" ref={bankRef}>
        <KeyBank keys={isAdmin ? ADMIN_KEYS : KEYS} />
      </div>
      <div className="hw-side-tools">
        <div className="hw-side-theme">
          <span className="hw-label" aria-hidden="true">
            Dark
          </span>
          <ThemeSwitch />
        </div>
        {/* A plain link: a prefetch must never sign anyone out */}
        <a href="/logout" className="hw-link hw-side-signout">
          Sign out
        </a>
      </div>
      <div className="hw-side-status">{status}</div>
    </nav>
  );
}
