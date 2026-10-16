// Body and Plate: one machine body (Leica satin silver in light, black
// paint in dark) and the plates it is made of. A head plate holds the
// engraved name and the lamp; a plate with `seam` joins the one above it,
// a hair lower. The body's edge reaches 26px outside it (31.5px below), so
// leave that room round it. Classes in app/kit.css.

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/components/utils';

type BodyTag = 'div' | 'section' | 'article' | 'header' | 'form' | 'aside';

export function Body({
  as: Tag = 'div',
  className,
  children,
  ...rest
}: { as?: BodyTag; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...rest} className={cn('pk-body', className)}>
      {children}
    </Tag>
  );
}

export function Plate({
  head = false,
  seam = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: {
  /** The 58px head plate: name at the left, lamp at the right. */
  head?: boolean;
  /** Joins the plate above it with a seam. */
  seam?: boolean;
  as?: 'div' | 'header' | 'footer' | 'section';
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cn(
        head ? 'pk-plate-head' : 'pk-plate',
        seam && 'pk-seam',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** A plate's engraved name, with an optional number before it. */
export function PlateTitle({
  number,
  className,
  children,
}: {
  number?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('pk-plate-title', className)}>
      {number ? (
        <span className="pk-plate-num" aria-hidden="true">
          {number}
        </span>
      ) : null}
      {children}
    </span>
  );
}
