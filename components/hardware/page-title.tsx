// PageTitle: the page's h1, printed in ink on the ground in Big Shoulders
// (uppercase by CSS, so write it in sentence case). The optional aside is
// a mono line at the right, such as today's date, printed in ink too.
// `actions` holds keys at the right (for example a KeyGroup); they sit on
// the ground, not in the ink.

import type { ReactNode } from 'react';
import { cn } from '@/components/utils';

export function PageTitle({
  children,
  aside,
  actions,
  id,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn('hw-page-head', className)}>
      <h1 className="hw-title hw-ink" id={id}>
        {children}
      </h1>
      {aside || actions ? (
        <div className="hw-page-end">
          {aside ? (
            <span className="hw-page-aside hw-mono hw-ink">{aside}</span>
          ) : null}
          {actions ? <div className="hw-page-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
