'use client';

// The lever-key bank: the main navigation. Each key pivots under the
// plate on the left. The key for the current page stays down (its far end
// dips) and a red flag shows in the plate. Each position in the bank has
// its own moulding tone, right-edge offset and a fraction-of-a-pixel
// legend nudge, from the static KEY_FINISH table (never random, so server
// and client render the same markup). Dark mode has its own tones and
// offsets the mottle and grain of each key; app/hardware.css reads them
// only under data-theme="dark".

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/utils';

type Finish = {
  tone: string;
  offset?: string;
  nudge?: string;
  /** Dark mode: moulding tone, then mottle and grain tile offsets. */
  dark?: string;
  mottle?: string;
  grain?: string;
};

/** Key finishes by position in the bank, from the approved Home-E and
 *  Home-E-dark boards (Home, Slips, Studio, Photo, Tape, History, Printer,
 *  Users). */
export const KEY_FINISH: readonly Finish[] = [
  { tone: '#e9e4d8', dark: '#4a4944' },
  {
    tone: '#ece8df',
    offset: '.5px',
    nudge: 'translate(.3px,-.4px)',
    dark: '#4c4b47',
    mottle: '-210px -90px',
    grain: '-61px -23px',
  },
  {
    tone: '#eae6dc',
    dark: '#4a4945',
    mottle: '-70px -260px',
    grain: '-17px -88px',
  },
  {
    tone: '#ede9e0',
    offset: '1px',
    nudge: 'translate(.5px,0) rotate(-.15deg)',
    dark: '#4d4c48',
    mottle: '-330px -150px',
    grain: '-104px -41px',
  },
  {
    tone: '#ebe7de',
    offset: '.5px',
    nudge: 'rotate(-.1deg)',
    mottle: '-150px -400px',
    grain: '-39px -130px',
  },
  {
    tone: '#ece8de',
    nudge: 'translateY(.4px)',
    dark: '#4c4b46',
    mottle: '-260px -330px',
    grain: '-122px -9px',
  },
  {
    tone: '#ebe8de',
    dark: '#4b4945',
    mottle: '-40px -170px',
    grain: '-77px -66px',
  },
  {
    tone: '#ede9e1',
    offset: '.5px',
    nudge: 'translate(-.4px,-.3px) rotate(.12deg)',
    dark: '#4d4b47',
    mottle: '-380px -20px',
    grain: '-8px -150px',
  },
];

export function NavKey({
  href,
  current = false,
  finish = 0,
  className,
  children,
}: {
  href: string;
  current?: boolean;
  /** Position in KEY_FINISH. KeyBank passes the key's index. */
  finish?: number;
  className?: string;
  children: ReactNode;
}) {
  const f = KEY_FINISH[finish % KEY_FINISH.length];
  const face = {
    '--tone': f.tone,
    ...(f.offset ? { '--o': f.offset } : {}),
    ...(f.dark ? { '--tone-dark': f.dark } : {}),
    ...(f.mottle ? { '--mp': f.mottle } : {}),
    ...(f.grain ? { '--gp': f.grain } : {}),
  } as CSSProperties;
  return (
    <Link
      href={href}
      className={cn('hw-key', className)}
      aria-current={current ? 'page' : undefined}
    >
      <span className="hw-key-flag" aria-hidden="true" />
      <span className="hw-key-face" style={face}>
        <span
          className="hw-legend"
          style={f.nudge ? { transform: f.nudge } : undefined}
        >
          {children}
        </span>
      </span>
    </Link>
  );
}

export type BankKey = { href: string; label: string };

/** The key whose href is the path or a parent of it ('/' only exactly). */
export function currentKey(keys: readonly BankKey[], pathname: string) {
  let best: BankKey | undefined;
  for (const k of keys) {
    const hit =
      k.href === '/'
        ? pathname === '/'
        : pathname === k.href || pathname.startsWith(`${k.href}/`);
    if (hit && (!best || k.href.length > best.href.length)) best = k;
  }
  return best?.href;
}

export function KeyBank({
  keys,
  current,
  className,
}: {
  keys: readonly BankKey[];
  /** href of the current key; read from the URL when left out. */
  current?: string;
  className?: string;
}) {
  const pathname = usePathname() ?? '/';
  const active = current ?? currentKey(keys, pathname);
  return (
    <div className={cn('hw-keybank', className)}>
      {keys.map((k, i) => (
        <NavKey
          key={k.href}
          href={k.href}
          finish={i}
          current={k.href === active}
        >
          {k.label}
        </NavKey>
      ))}
    </div>
  );
}
