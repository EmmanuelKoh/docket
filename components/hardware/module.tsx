// Module: a painted panel with a black label plate as its heading. The
// plate shows an optional number (hidden from assistive tech) and the
// title, which names the section. The body is padded unless `flush`, for
// a module that holds rows edge to edge.

import { type ReactNode, useId } from 'react';
import { cn } from '@/components/utils';

export function Module({
  title,
  number,
  id,
  flush = false,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  /** Plate number, such as "01". Use it only when the order means something. */
  number?: string;
  /** Id of the heading; generated when omitted. */
  id?: string;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const generated = useId();
  const headingId = id ?? `${generated}-plate`;
  return (
    <section
      className={cn('hw-module hw-panel', className)}
      aria-labelledby={headingId}
    >
      <h2 className="hw-plate" id={headingId}>
        {number ? (
          <span className="hw-silk" aria-hidden="true">
            {number}
          </span>
        ) : null}
        <span className="hw-silk">{title}</span>
      </h2>
      <div
        className={cn(
          'hw-module-body',
          !flush && 'hw-module-body--padded',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
