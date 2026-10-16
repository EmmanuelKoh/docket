// A Users plate: its number and name engraved in a label column at the
// left, its rows or fields at the right (as Photo labels its controls).
// Below 1180px the name sits above the content. The name is the plate's
// h2. Server and client parts both use it.

import type { ReactNode } from 'react';
import { Plate } from '@/components/hardware/kit/body';
import { cn } from '@/components/utils';

export function UsersPlate({
  id,
  number,
  title,
  className,
  children,
}: {
  id: string;
  number: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Plate
      seam
      as="section"
      aria-labelledby={id}
      className={cn(
        'grid gap-y-[10px] min-[1180px]:grid-cols-[176px_minmax(0,1fr)] min-[1180px]:gap-x-6',
        className,
      )}
    >
      <h2
        id={id}
        className="pk-plate-title m-0 min-[1180px]:self-start min-[1180px]:pt-[13px]"
      >
        <span className="pk-plate-num" aria-hidden="true">
          {number}
        </span>
        <span className="pk-engr">{title}</span>
      </h2>
      <div className="min-w-0">{children}</div>
    </Plate>
  );
}
