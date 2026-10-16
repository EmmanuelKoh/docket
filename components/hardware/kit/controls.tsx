// The small controls of the parts kit: the short slider (Fader), the Leica
// push key and the Capture release. Classes in app/kit.css.

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from '@/components/utils';

/** A short slider: a slot cut through the plate, a ribbed cap with a white
 *  index line, engraved end marks; `centered` adds a centre mark for a
 *  zero in the middle. All input props pass through. */
export function Fader({
  centered = false,
  className,
  ...input
}: { centered?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>) {
  return (
    <input
      {...input}
      type="range"
      className={cn('pk-fader', centered && 'pk-fader--centered', className)}
    />
  );
}

type LeicaBase = {
  /** The 96px key (Sign out). */
  wide?: boolean;
  /** Held down by state. */
  down?: boolean;
  /** The engraved legend. */
  children: ReactNode;
  className?: string;
};

/** The Leica push key: one satin key (black paint in dark) in its own
 *  slot, its name engraved on it. With `href` it is a plain <a> (no
 *  prefetch: use it for Sign out); otherwise a button. */
export function LeicaKey(
  props:
    | (LeicaBase & { href?: undefined } & Omit<
          ButtonHTMLAttributes<HTMLButtonElement>,
          'children' | 'className'
        >)
    | (LeicaBase & { href: string } & Omit<
          AnchorHTMLAttributes<HTMLAnchorElement>,
          'children' | 'className' | 'href'
        >),
) {
  const { wide = false, down = false, children, className, ...rest } = props;
  const cls = cn(
    'pk-lkey',
    wide && 'pk-lkey--wide',
    down && 'is-down',
    className,
  );
  const legend = <span className="pk-engr">{children}</span>;
  if (rest.href !== undefined) {
    const a = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a {...a} className={cls}>
        {legend}
      </a>
    );
  }
  const { type = 'button', ...b } =
    rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...b} type={type} className={cls}>
      {legend}
    </button>
  );
}

/** Capture: the soft release on its stepped collar, the red dot on its
 *  cap. Disabled shows it locked (matte, the dot dull), not faded. */
export function Shutter({
  label = 'Capture',
  down = false,
  className,
  type = 'button',
  ...button
}: {
  /** Accessible name. */
  label?: string;
  down?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      {...button}
      type={type}
      aria-label={label}
      className={cn('pk-shutter', down && 'is-down', className)}
    />
  );
}
