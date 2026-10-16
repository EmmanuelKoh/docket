'use client';

// Switch: the ribbed slide switch, in a slot cut through the plate, with
// its two positions engraved either side. role="switch" with aria-checked;
// `label` is its accessible name (the engraved names are aria-hidden).
//
// variant "onoff" (default) prints OFF and ON and paints the orange mark
// that the cap uncovers at ON. variant "mode" has a plain floor and prints
// the two modes (`legends`, such as Template and Data); checked is the
// second one. `legends={false}` prints nothing (the row names it).
//
// Two ways to drive it:
// - onChange: the parent owns the state and passes the new `checked`.
// - onToggle: the switch moves at once and waits for the promise; while it
//   waits it ignores clicks (aria-busy). If the promise rejects, the cap
//   goes back and onError gets the reason. A new `checked` from the parent
//   (for example after router.refresh) always wins.

import { type ReactNode, useState } from 'react';
import { cn } from '@/components/utils';

type Base = {
  checked: boolean;
  /** Accessible name, such as the slip's title or "Dark". */
  label: string;
  variant?: 'onoff' | 'mode';
  /** The engraved names at the off and on ends; false for none. */
  legends?: readonly [ReactNode, ReactNode] | false;
  disabled?: boolean;
  id?: string;
  className?: string;
};

type Controlled = Base & {
  onChange: (next: boolean) => void;
  onToggle?: never;
  onError?: never;
};

type Async = Base & {
  onToggle: (next: boolean) => Promise<unknown>;
  onError?: (reason: unknown) => void;
  onChange?: never;
};

export function Switch(props: Controlled | Async) {
  const {
    checked,
    label,
    variant = 'onoff',
    legends = variant === 'onoff' ? ['Off', 'On'] : false,
    disabled = false,
    id,
    className,
  } = props;
  const [held, setHeld] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [seen, setSeen] = useState(checked);
  if (seen !== checked) {
    setSeen(checked);
    setHeld(null);
  }
  const on = held ?? checked;

  async function flip() {
    if (disabled || pending) return;
    const next = !on;
    if (props.onChange) {
      props.onChange(next);
      return;
    }
    const before = held;
    setHeld(next);
    setPending(true);
    try {
      await props.onToggle(next);
    } catch (reason) {
      setHeld(before);
      props.onError?.(reason);
    } finally {
      setPending(false);
    }
  }

  const soft = variant === 'onoff';
  const button = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={on}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={flip}
      className={cn(
        'pk-switch',
        variant === 'onoff' && 'pk-switch--onoff',
        !legends && className,
      )}
    >
      <span className="pk-switch-track" aria-hidden="true">
        <span className="pk-switch-cap" />
      </span>
    </button>
  );
  if (!legends) return button;
  return (
    <span className={cn('pk-switch-row', className)}>
      <span
        className={cn('pk-engr', soft && 'pk-engr--soft')}
        aria-hidden="true"
      >
        {legends[0]}
      </span>
      {button}
      <span
        className={cn('pk-engr', soft && 'pk-engr--soft')}
        aria-hidden="true"
      >
        {legends[1]}
      </span>
    </span>
  );
}
