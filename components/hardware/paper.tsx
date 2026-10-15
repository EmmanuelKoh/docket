// Receipt paper: the printer's front edge, the roll of slips under it, and
// one slip. A slip is 624px wide with the receipt image at its true 576px;
// on a narrow screen the whole slip scales down together. This module
// loads paper.css, so only pages that show paper carry it.
//
// <PrinterEdge />
// <PaperRoll>
//   <PaperSlip src=… alt=… height={h} tear="new" fed />
//   <PaperSlip src=… alt=… height={h} tear="old" rotate={-0.6} shiftX={5} />
// </PaperRoll>

import './paper.css';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/utils';

export function PrinterEdge({ className }: { className?: string }) {
  return (
    <div className={cn('hw-printer-edge', className)} aria-hidden="true" />
  );
}

/** The column under the edge: its first slip tucks under the tear bar. */
export function PaperRoll({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('hw-roll', className)}>{children}</div>;
}

export type Tear = 'new' | 'old' | 'solo' | 'none';

const TEAR_CLASS: Record<Tear, string | false> = {
  new: 'hw-tear-new',
  old: 'hw-tear-old',
  solo: 'hw-tear-solo',
  none: false,
};

export function PaperSlip({
  src,
  alt = '',
  width = 576,
  height,
  loading,
  tear = 'solo',
  fed = false,
  rotate,
  shiftX,
  streakOffset,
  exact = false,
  maxHeight,
  className,
  children,
}: {
  /** The receipt image; leave it out for a blank slip with children. */
  src?: string;
  alt?: string;
  /** Intrinsic size of the image, so the slip reserves its height. */
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  /** new: torn at the bottom, the newest slip. old: torn top and bottom.
      solo: a single slip torn at the bottom. none: straight edges. */
  tear?: Tear;
  /** Still feeding out of the printer: shaded at the top, tilted 0.25deg. */
  fed?: boolean;
  /** Slight tilt in degrees, such as -0.6, for a slip lying on the ground. */
  rotate?: number;
  /** Slight sideways offset in px, used with rotate. */
  shiftX?: number;
  /** Shifts the head streak pattern so two slips do not match. */
  streakOffset?: number;
  /** True pixels for Studio and Photo previews: no image filter, no
      streaks, no grain, no tilt. */
  exact?: boolean;
  /** Tears the slip off at this height in px (a very long receipt). */
  maxHeight?: number;
  className?: string;
  /** Extra content on the paper, such as a note on a blank slip. */
  children?: ReactNode;
}) {
  const tilt =
    !exact && (rotate || shiftX)
      ? ({
          transform: `rotate(${rotate ?? 0}deg) translateX(${shiftX ?? 0}px)`,
        } as CSSProperties)
      : undefined;
  return (
    <div
      className={cn(
        'hw-lift',
        fed && !exact && 'hw-lift--fed',
        exact && 'hw-lift--exact',
        className,
      )}
      style={tilt}
    >
      <div
        className={cn(
          'hw-paper',
          TEAR_CLASS[tear],
          fed && 'hw-paper--fed',
          exact && 'hw-paper--exact',
        )}
        style={maxHeight ? { maxHeight, overflow: 'hidden' } : undefined}
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            loading={loading}
            decoding="async"
          />
        ) : null}
        {children}
        {src && !exact ? (
          <i
            className="hw-streak"
            aria-hidden="true"
            style={
              streakOffset
                ? { backgroundPosition: `0 ${streakOffset}px` }
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );
}
