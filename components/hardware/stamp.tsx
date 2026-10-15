// Stamp: a rubber stamp for a job's outcome. The text is the accessible
// name; it is sentence case in the source and prints in capitals. `alt`
// gives a second rotation and ink pattern, for alternate rows. `paper`
// keeps the light inks for a stamp pressed on a receipt, which is white
// in both themes. Other HTML props (id, aria-*) pass through.

import type { HTMLAttributes } from 'react';
import { cn } from '@/components/utils';

export type StampState = 'printed' | 'canceled' | 'failed';

const TEXT: Record<StampState, string> = {
  printed: 'Printed',
  canceled: 'Canceled',
  failed: 'Failed',
};

export function Stamp({
  state,
  alt = false,
  paper = false,
  className,
  children,
  ...rest
}: {
  state: StampState;
  alt?: boolean;
  paper?: boolean;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={cn(
        'hw-stamp',
        state === 'canceled' && 'hw-stamp--void',
        state === 'failed' && 'hw-stamp--fail',
        alt && 'hw-stamp--alt',
        paper && 'hw-stamp--paper',
        className,
      )}
    >
      {children ?? TEXT[state]}
    </span>
  );
}
