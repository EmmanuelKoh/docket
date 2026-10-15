// Row: one line on a panel with a dashed rule under it (the last row of a
// module has none). `tight` is for a row that holds a 44px control, `off`
// prints the whole row in the tertiary ink. RowText is the usual left side:
// a 600-weight title over a mono line (uppercase by CSS; a text line keeps
// its unit symbols in lower case, see Units).

import type { HTMLAttributes, ReactNode } from 'react';
import { Units } from '@/components/hardware/text';
import { cn } from '@/components/utils';

export function Row({
  as: Tag = 'div',
  tight = false,
  off = false,
  className,
  children,
  ...rest
}: {
  as?: 'div' | 'li';
  tight?: boolean;
  off?: boolean;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        'hw-row',
        tight && 'hw-row--tight',
        off && 'hw-row--off',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function RowText({
  title,
  sub,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('hw-row-text', className)}>
      <span className="hw-row-title">{title}</span>
      {sub ? (
        <span className="hw-row-sub">
          {typeof sub === 'string' ? <Units>{sub}</Units> : sub}
        </span>
      ) : null}
    </span>
  );
}
