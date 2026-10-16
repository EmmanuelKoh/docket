// Sheet: a record sheet of uncoated stock lying on the mat: a printed band
// with its number and label, entries with printed dashed rules between
// them, one corner lifting a little off the mat. Sheets came from
// different reams: `index` picks each one's lie, stock tone and lifted
// corner from a fixed table (never random, so server and client agree).
// Type on it with .pk-sheet-ink (and .pk-sheet-sub for a quieter line);
// make a whole entry the target with .pk-sheet-line. Rows: plain rows on
// a plate (name and detail at the left, a control at the right).
// Classes in app/kit.css.

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/components/utils';

/** rotation (deg), sideways offset (px), stock (light, dark), lifted corner */
const LIE = [
  { rot: -0.35, dx: -3, stock: ['#f3f1ec', '#2b2a27'], lift: 'br' },
  { rot: 0.22, dx: 4, stock: ['#efede7', '#2e2d2a'], lift: 'bl' },
  { rot: -0.15, dx: -1, stock: ['#f6f4f0', '#292826'], lift: 'tr' },
] as const;

export function Sheet({
  index = 0,
  number,
  title,
  headId,
  as: Tag = 'section',
  className,
  children,
}: {
  /** The sheet's place on the mat (its lie repeats every three). */
  index?: number;
  /** Printed at the band's left, such as "01" (aria-hidden). */
  number?: string;
  /** Printed at the band's right; names the sheet. */
  title: ReactNode;
  headId?: string;
  as?: 'section' | 'div';
  className?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const id = headId ?? `${auto}-head`;
  const lie = LIE[index % LIE.length];
  const style = {
    '--pk-sheet-rot': `${lie.rot}deg`,
    '--pk-sheet-dx': `${lie.dx}px`,
    '--pk-sheet-stock-l': lie.stock[0],
    '--pk-sheet-stock-d': lie.stock[1],
    '--pk-sheet-n': index,
  } as CSSProperties;
  return (
    <Tag
      className={cn('pk-sheet', `pk-sheet--lift-${lie.lift}`, className)}
      style={style}
      aria-labelledby={id}
    >
      <h2 className="pk-sheet-head" id={id}>
        {number ? <span aria-hidden="true">{number}</span> : null}
        <span>{title}</span>
      </h2>
      {children}
    </Tag>
  );
}

export function SheetRows({
  className,
  ...rest
}: HTMLAttributes<HTMLUListElement>) {
  return <ul {...rest} className={cn('pk-sheet-rows', className)} />;
}

export function SheetRow({
  className,
  ...rest
}: HTMLAttributes<HTMLLIElement>) {
  return <li {...rest} className={cn('pk-sheet-row', className)} />;
}

/** Rows on a plate, on a 48px pitch; `ruled` engraves a line between. */
export function Rows({
  ruled = false,
  className,
  ...rest
}: { ruled?: boolean } & HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      {...rest}
      className={cn('pk-rows', ruled && 'pk-rows--ruled', className)}
    />
  );
}

export function Row({ className, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li {...rest} className={cn('pk-row', className)} />;
}

/** A row's engraved name and its softer second line. */
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
    <span className={cn('pk-row-text', className)}>
      <span className="pk-engr">{title}</span>
      {sub ? (
        <span className="pk-engr pk-engr--soft pk-row-sub">{sub}</span>
      ) : null}
    </span>
  );
}
