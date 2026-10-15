// Led: a 3 mm LED in a black collar. Green means online, nothing else.
// Red means printing or an error. Off is offline. `lens="red"` gives a red
// LED that is off (Tape's Record lamp): its epoxy reads dark red, not
// green. It is decorative next to a text state; pass `label` only when it
// stands alone.

import { cn } from '@/components/utils';

export type LedState = 'online' | 'printing' | 'error' | 'offline';

export function Led({
  state,
  lens = 'green',
  label,
  className,
}: {
  state: LedState;
  /** The colour of the epoxy when the LED is off. */
  lens?: 'green' | 'red';
  label?: string;
  className?: string;
}) {
  const cls = cn(
    'hw-led',
    state === 'online' && 'hw-led--on',
    (state === 'printing' || state === 'error') && 'hw-led--red',
    lens === 'red' && 'hw-led--red-lens',
    className,
  );
  if (label) return <span className={cls} role="img" aria-label={label} />;
  return <span className={cls} aria-hidden="true" />;
}
