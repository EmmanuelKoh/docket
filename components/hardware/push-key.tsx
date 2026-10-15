// Push keys: matte keys that share one dark cutout (KeyGroup). A pressed
// key sinks straight down. The red `print` variant is the only red key and
// commits a print. `down` holds a key down: the current choice in a group
// of link keys (it then sets aria-current), or a toggle (pass aria-pressed
// yourself). A key with `href` is a next/link Link; otherwise a button.
// `led` sets an LED into the key, left of the legend; an icon goes in the
// children, with the legend text.
//
// A KeyGroup with a `legend` is a fieldset: the legend is a field label
// above the cutout (or only for assistive tech, with legendHidden). A
// group without one passes its HTML props (id, role, aria-*) to the
// cutout; a group of link keys gets its name from its container, for
// example <nav aria-label="Filter">.

import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from '@/components/utils';

type KeyGroupProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** Names the group: the group becomes a fieldset with this legend. */
  legend?: ReactNode;
  /** Keeps the legend for assistive tech only. */
  legendHidden?: boolean;
  children: ReactNode;
};

export function KeyGroup({
  legend,
  legendHidden = false,
  className,
  children,
  ...rest
}: KeyGroupProps) {
  if (legend === undefined) {
    return (
      <span className={cn('hw-keys', className)} {...rest}>
        {children}
      </span>
    );
  }
  return (
    <fieldset className={cn('hw-keyset', className)} {...rest}>
      <legend
        className={legendHidden ? 'sr-only' : 'hw-field-label hw-keyset-legend'}
      >
        {legend}
      </legend>
      <span className="hw-keys">{children}</span>
    </fieldset>
  );
}

type KeyLook = {
  variant?: 'default' | 'print';
  /** compact: 38px, for ledger rows. large: 60px, the one large key. */
  size?: 'default' | 'compact' | 'large';
  down?: boolean;
  /** An LED set into the key, left of the legend (a <Led />). */
  led?: ReactNode;
  /** Moulding tone of this key, such as "#ebe7de". */
  tone?: string;
  className?: string;
  children: ReactNode;
};

type ButtonKeyProps = KeyLook &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    href?: undefined;
  };

type LinkKeyProps = KeyLook &
  Omit<ComponentProps<typeof Link>, 'className' | 'children'> & {
    /** A disabled link key renders as a disabled button. */
    disabled?: boolean;
  };

export function PushKey(props: ButtonKeyProps | LinkKeyProps) {
  const {
    variant = 'default',
    size = 'default',
    down = false,
    tone,
    led,
    className,
    children,
    ...rest
  } = props;
  const cls = cn(
    'hw-push',
    variant === 'print' && 'hw-push--print',
    size === 'compact' && 'hw-push--compact',
    size === 'large' && 'hw-push--large',
    down && 'hw-push--down',
    className,
  );
  const face = (
    <>
      {led}
      <span className="hw-legend">{children}</span>
    </>
  );
  const toned = (own?: CSSProperties) =>
    tone ? ({ '--tone': tone, ...own } as CSSProperties) : own;

  if (rest.href !== undefined) {
    const { disabled, style, ...linkProps } = rest as Omit<
      LinkKeyProps,
      keyof KeyLook
    >;
    if (disabled) {
      return (
        <button type="button" disabled className={cls} style={toned(style)}>
          {face}
        </button>
      );
    }
    return (
      <Link
        aria-current={down ? 'true' : undefined}
        {...linkProps}
        style={toned(style)}
        className={cls}
      >
        {face}
      </Link>
    );
  }

  const {
    type = 'button',
    style,
    href: _href,
    ...buttonProps
  } = rest as Omit<ButtonKeyProps, keyof KeyLook>;
  return (
    <button type={type} {...buttonProps} style={toned(style)} className={cls}>
      {face}
    </button>
  );
}
