// CounterWindow and Drum: drums behind a small window cut through the
// plate. A drum shows its value with the neighbours turning away above and
// below it. CounterWindow shows a value as digit drums (and an optional
// name drum); it only displays. For a counter you can step, use Counter
// (counter.tsx). Classes in app/kit.css.

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/utils';

export function Drum({
  value,
  prev,
  next,
  name = false,
  width,
}: {
  value: ReactNode;
  prev?: ReactNode;
  next?: ReactNode;
  /** A name drum: wider, the name left-aligned. */
  name?: boolean;
  /** Minimum width in CSS px (a name drum never resizes as it turns). */
  width?: number;
}) {
  return (
    <span
      className={cn('pk-drum', name && 'pk-drum--name')}
      style={width ? ({ minWidth: `${width}px` } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {prev !== undefined ? <span className="pk-drum-prev">{prev}</span> : null}
      <span>{value}</span>
      {next !== undefined ? <span className="pk-drum-next">{next}</span> : null}
    </span>
  );
}

/** One drum per character; digits show their neighbours (9 above 0). */
export function digitDrums(text: string) {
  return [...text].map((ch, i) => {
    const d = Number(ch);
    const digit = ch !== ' ' && Number.isInteger(d);
    return (
      <Drum
        // a drum per position: its key is its place in the window
        key={i}
        value={ch}
        prev={digit ? (d + 9) % 10 : undefined}
        next={digit ? (d + 1) % 10 : undefined}
      />
    );
  });
}

export function CounterWindow({
  value,
  label,
  legend,
  className,
}: {
  /** The characters on the drums, such as "015" or "12". */
  value: string;
  /** What the window says, for assistive tech ("15 receipts"). */
  label: string;
  /** Engraved after the window ("Receipts", "Sec"), aria-hidden. */
  legend?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('pk-counter', className)}>
      <span className="pk-counter-window" aria-hidden="true">
        {digitDrums(value)}
      </span>
      {legend ? (
        <span className="pk-engr" aria-hidden="true">
          {legend}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}
