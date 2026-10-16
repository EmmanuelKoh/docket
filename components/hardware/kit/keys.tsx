// KeyWell and Key: tape-deck keys standing in one well cut through the
// plate, a black legend strip above them. The red print key commits a
// print and goes last. The legend is the key's accessible name.
//
// A key is a button, or a next/link Link with `href`. `pressed` latches it
// (aria-pressed: a filter, a mode); `down` holds it down by state (.is-down,
// or aria-current on a link: the current choice among link keys).
// `compact` is the same well at 72% for row actions; `fill` shares the
// body's width between the keys (phones). Each key in a well is a hair off
// the next in moulding and legend (CSS, by position). Classes in
// app/kit.css.

import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from '@/components/utils';

export function KeyWell({
  label,
  compact = false,
  fill = false,
  className,
  children,
  ...rest
}: {
  /** Names the group for assistive tech ("Template", "Filter"). */
  label?: string;
  compact?: boolean;
  fill?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLFieldSetElement>) {
  return (
    <fieldset
      aria-label={label}
      {...rest}
      className={cn(
        'pk-keys',
        compact && 'pk-keys--compact',
        fill && 'pk-keys--fill',
        className,
      )}
    >
      {children}
    </fieldset>
  );
}

type KeyBase = {
  /** The printed legend; it names the key. */
  legend: ReactNode;
  print?: boolean;
  /** Held down by state: the current choice, a running mode. */
  down?: boolean;
  /** Width in CSS px (default 88, print 104). */
  width?: number;
  className?: string;
  style?: CSSProperties;
};

type ButtonKey = KeyBase & {
  href?: undefined;
  /** A latching key: aria-pressed. */
  pressed?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;

type LinkKey = KeyBase & {
  href: string;
  pressed?: never;
  disabled?: boolean;
} & Omit<
    ComponentProps<typeof Link>,
    'href' | 'children' | 'className' | 'style'
  >;

export function Key(props: ButtonKey | LinkKey) {
  const {
    legend,
    print = false,
    down = false,
    width,
    className,
    style,
  } = props;
  const cls = cn(
    'pk-key',
    print && 'pk-key--print',
    down && !props.href && 'is-down',
    className,
  );
  const st = width
    ? ({ ...style, '--w': `${width}px` } as CSSProperties)
    : style;
  const inner = (
    <>
      <span className="pk-key-legend">{legend}</span>
      <span className="pk-key-cap" aria-hidden="true" />
    </>
  );

  if (props.href !== undefined) {
    const {
      legend: _l,
      print: _p,
      down: _d,
      width: _w,
      className: _c,
      style: _s,
      pressed: _pr,
      disabled,
      href,
      ...link
    } = props;
    if (disabled) {
      return (
        <button type="button" disabled className={cls} style={st}>
          {inner}
        </button>
      );
    }
    return (
      <Link
        aria-current={down ? 'true' : undefined}
        {...link}
        href={href}
        className={cls}
        style={st}
      >
        {inner}
      </Link>
    );
  }

  const {
    legend: _l,
    print: _p,
    down: _d,
    width: _w,
    className: _c,
    style: _s,
    pressed,
    href: _h,
    type = 'button',
    ...button
  } = props;
  return (
    <button
      {...button}
      type={type}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cls}
      style={st}
    >
      {inner}
    </button>
  );
}
