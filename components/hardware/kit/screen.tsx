// Screens and set-in parts of the body. Screen: a window cut through the
// plate with a display behind it: e-ink (light), the dark screen, the
// photo LCD, or "editor" (e-ink in light, the dark screen in dark). The
// display's medium and the cover glass sit over the content. Leather: the
// leatherette set into the body. Platen: the teleprinter slot a slip
// rises out of. PrinterBlock: the printer's front edge with a slip feeding
// out from under its tear bar. Classes in app/kit.css.

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/components/utils';

export function Screen({
  kind = 'eink',
  bezel,
  className,
  screenClassName,
  style,
  children,
  ...rest
}: {
  kind?: 'eink' | 'dark' | 'lcd' | 'editor';
  /** Black bezel between the window's edge and the display, CSS px. */
  bezel?: number;
  /** Class for the display inside the window. */
  screenClassName?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('pk-window', className)}
      style={
        bezel === undefined
          ? style
          : ({ ...style, '--pk-bezel': `${bezel}px` } as CSSProperties)
      }
    >
      <div
        {...rest}
        className={cn('pk-screen', `pk-screen--${kind}`, screenClassName)}
      >
        {children}
      </div>
    </div>
  );
}

export function Leather({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('pk-leather', className)} />;
}

/** The slot in the plate; put a Slip with tear="top" in it. The slip
 *  stands up out of the slot, absolutely placed, so leave room above. */
export function Platen({
  width,
  className,
  children,
}: {
  /** The slot's width in CSS px (default 352, never wider than its box). */
  width?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn('pk-platen', className)}
      style={
        width ? ({ '--pk-platen-w': `${width}px` } as CSSProperties) : undefined
      }
    >
      {children}
    </div>
  );
}

/** 340px for a 320px slip; put a Slip with tear="new" in it. */
export function PrinterBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('pk-printer', className)}>
      <div className="pk-printer-edge" aria-hidden="true" />
      {children}
    </div>
  );
}
