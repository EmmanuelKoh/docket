'use client';

// The nav unit: the dashboard's main navigation as one piece of the parts
// kit (design spec: shell; classes in app/kit.css).
//
// Wide (876px and up): a column unit at the left. DOCKET and the version
// engraved into the top plate; a well with the long lever keys, each with
// its flag window in the plate beside it (the red flag marks the current
// page); a seam; the foot plate with the printer LED, its name and state,
// the Dark switch and Sign out. A lever pivots under the plate at its
// left end, so the current page's key has its far end dipped into the
// well. The unit rides a slim track that runs the full height of the page
// and scrolls with it; two knurled rollers in the track's slot, one above
// and one below the unit, turn as the page scrolls (scroll-driven CSS,
// still under reduced motion).
//
// Narrow (875px and below): the same unit as a top bar: DOCKET and the
// printer LED, the keys as one sideways strip (flag windows above them),
// then the Dark switch and Sign out. The current key is brought into the
// strip on load and on each page change.
//
// The layout passes the printer line in as a slot that streams in on its
// own (app/(dashboard)/printer-status.tsx).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, useEffect, useRef } from 'react';
import { LeicaKey } from '@/components/hardware/kit/controls';
import { ThemeSwitch } from '@/components/theme-switch';

export type NavKey = { href: string; label: string };

const KEYS: readonly NavKey[] = [
  { href: '/', label: 'Home' },
  { href: '/slips', label: 'Slips' },
  { href: '/studio', label: 'Studio' },
  { href: '/photo', label: 'Photo' },
  { href: '/tape', label: 'Tape' },
  { href: '/history', label: 'History' },
  { href: '/printer', label: 'Printer' },
];
const ADMIN_KEYS: readonly NavKey[] = [
  ...KEYS,
  { href: '/users', label: 'Users' },
];

/** Key-to-key moulding differences by position: a tone filter on the cap,
 *  where the print wear falls on the legend, the legend a fraction off.
 *  Fixed, so server and client render the same markup. */
const FINISH: readonly { tone: string; wear: string; nudge: string }[] = [
  { tone: 'brightness(.996)', wear: '0 0', nudge: '.3px -.2px' },
  { tone: 'brightness(1.009)', wear: '-37px -11px', nudge: '-.2px .25px' },
  {
    tone: 'brightness(.99) hue-rotate(-2deg)',
    wear: '-61px -48px',
    nudge: '.15px .3px',
  },
  { tone: 'brightness(1.004)', wear: '-14px -70px', nudge: '-.3px -.1px' },
  {
    tone: 'brightness(.993) hue-rotate(1.5deg)',
    wear: '-79px -26px',
    nudge: '.25px .1px',
  },
  { tone: 'brightness(1.011)', wear: '-28px -55px', nudge: '0 -.3px' },
  { tone: 'brightness(.998)', wear: '-50px -5px', nudge: '-.15px .2px' },
  {
    tone: 'brightness(.988) hue-rotate(-1deg)',
    wear: '-7px -33px',
    nudge: '.35px 0',
  },
];

/** The key whose href is the path or a parent of it ('/' only exactly). */
export function currentKey(keys: readonly NavKey[], pathname: string) {
  let best: NavKey | undefined;
  for (const k of keys) {
    const hit =
      k.href === '/'
        ? pathname === '/'
        : pathname === k.href || pathname.startsWith(`${k.href}/`);
    if (hit && (!best || k.href.length > best.href.length)) best = k;
  }
  return best?.href;
}

/** Track screws: a pair every 320px, slots turned three ways, far enough
 *  down for the longest page (the track clips the rest). */
const SCREWS = Array.from({ length: 64 }, (_, i) => ({
  top: 170 + 320 * i,
  l: 'abcbca'[i % 6],
  r: 'abcbca'[(i + 2) % 6],
}));

function Track() {
  return (
    <div className="tk-track" aria-hidden="true">
      {SCREWS.map((s) => (
        <span key={s.top}>
          <span className={`tk-screw l ${s.l}`} style={{ top: `${s.top}px` }} />
          <span className={`tk-screw r ${s.r}`} style={{ top: `${s.top}px` }} />
        </span>
      ))}
    </div>
  );
}

/** The knurl's displacement maps (geometry only, the same in both
 *  themes): the ridges crowd toward the ends of each wheel's visible arc. */
function KnurlWarps() {
  const warp = (id: string, src: string, h: number) => (
    <filter
      id={id}
      x="0"
      y="0"
      width="24"
      height={h}
      filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feImage
        href={src}
        x="0"
        y="0"
        width="24"
        height={h}
        preserveAspectRatio="none"
        result="m"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="m"
        scale="16"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
    >
      {warp('tk-warp-t', '/hardware/nav/roller-top-warp.png', 28.8)}
      {warp('tk-warp-b', '/hardware/nav/roller-bot-warp.png', 48.2)}
    </svg>
  );
}

export function AppSidebar({
  status = null,
  isAdmin = false,
  version,
}: {
  /** The printer line: LED, name and state. */
  status?: React.ReactNode;
  isAdmin?: boolean;
  /** Engraved beside the wordmark, such as "v0.1.0". */
  version?: string;
}) {
  const pathname = usePathname() ?? '/';
  const keys = isAdmin ? ADMIN_KEYS : KEYS;
  const active = currentKey(keys, pathname);
  const navRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // On a phone the strip opens at its first key, so Tape, History, Printer
  // or Users would load with their key and red flag out of sight: bring
  // the current key to the start of the strip. Only the strip scrolls
  // (scrollIntoView could also scroll the page). It runs again on each
  // page change.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const key = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!key) return;
    strip.scrollLeft +=
      key.getBoundingClientRect().left - strip.getBoundingClientRect().left - 2;
  }, [pathname]);

  // A key that takes focus while only partly in the strip slides fully in,
  // so its focus ring is not cut by the plate's lip.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onFocus = (e: FocusEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      const key = (e.target as HTMLElement).closest<HTMLElement>('.pk-nav-key');
      if (!key) return;
      const k = key.getBoundingClientRect();
      const s = strip.getBoundingClientRect();
      if (k.left < s.left) strip.scrollLeft -= s.left - k.left + 2;
      else if (k.right > s.right) strip.scrollLeft += k.right - s.right + 2;
    };
    strip.addEventListener('focusin', onFocus);
    return () => strip.removeEventListener('focusin', onFocus);
  }, []);

  // The rollers' knurl travels with the scroll: the animation runs over the
  // page's scroll range, so the nav carries that range as --pk-roll-to.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const set = () => {
      const range = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      nav.style.setProperty('--pk-roll-to', `${range}px`);
    };
    set();
    const watch = new ResizeObserver(set);
    watch.observe(document.body);
    window.addEventListener('resize', set);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', set);
    };
  }, []);

  return (
    <>
      <Track />
      <nav
        aria-label="Main"
        className="pk-nav"
        ref={navRef}
        style={{ '--pk-nav-n': keys.length } as CSSProperties}
      >
        <div className="pk-body pk-nav-unit">
          <span className="tk-roller t" aria-hidden="true">
            <span className="tk-knurl" style={{ filter: 'url(#tk-warp-t)' }} />
          </span>
          <span className="tk-roller b" aria-hidden="true">
            <span className="tk-knurl" style={{ filter: 'url(#tk-warp-b)' }} />
          </span>
          <span className="tk-contact t" aria-hidden="true" />
          <span className="tk-contact b" aria-hidden="true" />
          <div className="pk-nav-brand">
            <span className="pk-nav-mark">DOCKET</span>
            {version ? <span className="pk-nav-version">{version}</span> : null}
          </div>
          <div className="pk-nav-bank">
            <div className="pk-nav-keys" ref={stripRef}>
              {keys.map((k, i) => {
                const f = FINISH[i % FINISH.length];
                return (
                  <Link
                    key={k.href}
                    href={k.href}
                    className="pk-nav-key"
                    aria-current={k.href === active ? 'page' : undefined}
                    style={{ '--pk-tone': f.tone } as CSSProperties}
                  >
                    <span className="pk-nav-flag" aria-hidden="true" />
                    <span className="pk-nav-cap" aria-hidden="true" />
                    <span
                      className="pk-nav-legend"
                      style={
                        {
                          '--nudge': f.nudge,
                          '--wear-at': f.wear,
                        } as CSSProperties
                      }
                    >
                      {k.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="pk-nav-foot pk-seam">
            <div className="pk-nav-status">{status}</div>
            <div className="pk-nav-theme">
              <span className="pk-engr" aria-hidden="true">
                Dark
              </span>
              <ThemeSwitch />
            </div>
            {/* A plain link: a prefetch must never sign anyone out */}
            <LeicaKey href="/logout" wide className="pk-nav-signout">
              Sign out
            </LeicaKey>
          </div>
        </div>
      </nav>
      <KnurlWarps />
    </>
  );
}
