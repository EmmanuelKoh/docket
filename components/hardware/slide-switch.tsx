'use client';

// SlideSwitch: a ribbed cap in a slot, with OFF and ON printed on the
// panel and an orange mark the cap uncovers at ON. role="switch" with
// aria-checked; `label` is its accessible name.
//
// Two ways to drive it:
// - onChange: the parent owns the state and passes the new `checked`.
// - onToggle: the switch moves at once and waits for the promise. While it
//   waits it ignores clicks (aria-busy). If the promise rejects, the cap
//   goes back and onError gets the reason. A new `checked` from the parent
//   (for example after router.refresh) always wins.

import { useState } from 'react';
import { cn } from '@/components/utils';

type Base = {
  checked: boolean;
  /** Accessible name, such as the slip's title. */
  label: string;
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

export function SlideSwitch(props: Controlled | Async) {
  const { checked, label, disabled = false, id, className } = props;
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

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={on}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={flip}
      className={cn('hw-switch', className)}
    >
      <span className="hw-switch-legend" aria-hidden="true">
        Off
      </span>
      <span className="hw-switch-track" aria-hidden="true">
        <span className="hw-switch-cap" />
      </span>
      <span className="hw-switch-legend" aria-hidden="true">
        On
      </span>
    </button>
  );
}
