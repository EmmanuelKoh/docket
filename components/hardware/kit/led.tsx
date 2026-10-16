// Led: a 3 mm diffused LED set in a black collar. Lime means online, nothing
// else. Red means printing or a failure. Off is offline. `lens="red"`
// gives a red LED that is off (a Record lamp). It is decorative next to a
// text state; pass `label` only when it stands alone. Lamp is the LED with
// its state engraved beside it. Classes in app/kit.css.

import type { ReactNode } from 'react';
import { cn } from '@/components/utils';

export type LedState = 'online' | 'printing' | 'error' | 'offline';

export function Led({
  state,
  lens = 'green',
  label,
  className,
}: {
  state: LedState;
  /** The colour of the lens when the LED is off. */
  lens?: 'green' | 'red';
  label?: string;
  className?: string;
}) {
  const lit = state !== 'offline';
  const cls = cn(
    'pk-led',
    state === 'online' && 'pk-led--on',
    (state === 'printing' || state === 'error') && 'pk-led--red-on',
    !lit && lens === 'red' && 'pk-led--red',
    className,
  );
  if (label) return <span className={cls} role="img" aria-label={label} />;
  return <span className={cls} aria-hidden="true" />;
}

export function Lamp({
  state,
  lens,
  className,
  children,
}: {
  state: LedState;
  lens?: 'green' | 'red';
  className?: string;
  /** The state, engraved: "Online", "Printing". */
  children: ReactNode;
}) {
  const red = state === 'printing' || state === 'error';
  return (
    <span className={cn('pk-lamp', className)}>
      <Led state={state} lens={lens} />
      <span className={cn('pk-engr', red && 'pk-engr--red')}>{children}</span>
    </span>
  );
}
