'use client';

// Counter: a counter window with a thumbwheel beside it, for choosing one
// of a list (a template, a crop). The drums show the choice's number and
// name. Click the wheel's top half to step back and its bottom half to
// step on; scroll over the counter, or press the up and down arrow keys
// on it, to step; click the window to open the list (a native select
// under the drums, which is also what assistive tech reads). There is no
// drag. The wheel turns one frame with each step.

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/components/utils';
import { Drum } from './counter-window';

export type CounterOption = { value: string; label: string };

const pad = (n: number, digits: number) => String(n).padStart(digits, '0');

export function Counter({
  label,
  options,
  value,
  onChange,
  digits = 2,
  showName = true,
  nameWidth = 132,
  wrap = true,
  legend,
  legendSide = 'before',
  disabled = false,
  id,
  className,
  style,
}: {
  /** The accessible name of the list ("Template"); the wheel buttons say
   *  "Previous template" and "Next template". */
  label: string;
  options: readonly CounterOption[];
  value: string;
  onChange: (value: string) => void;
  /** Number drums (the choice's place in the list); 0 for none. */
  digits?: number;
  /** A name drum after the number. */
  showName?: boolean;
  /** The name drum's width in CSS px: fit the longest name. */
  nameWidth?: number;
  /** Step past the last choice back to the first. */
  wrap?: boolean;
  /** Engraved beside the counter ("Crop"), aria-hidden. */
  legend?: ReactNode;
  legendSide?: 'before' | 'after';
  disabled?: boolean;
  /** The select's id (for a <label htmlFor>). */
  id?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(false);
  const n = options.length;
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  // latest values for the native wheel listener
  const live = useRef({ at, n, wrap, disabled, options, onChange });
  live.current = { at, n, wrap, disabled, options, onChange };

  const stepBy = (d: number) => {
    const s = live.current;
    if (s.disabled || s.n === 0) return;
    let j = s.at + d;
    if (s.wrap) j = (j + s.n) % s.n;
    else j = Math.min(s.n - 1, Math.max(0, j));
    if (j === s.at) return;
    setPhase((p) => !p);
    s.onChange(s.options[j].value);
  };
  const step = useRef(stepBy);
  step.current = stepBy;

  // Scroll steps it: a native listener, so the page does not scroll while
  // the pointer is over the counter (React's wheel listener is passive). A trackpad sends many small deltas,
  // so they add up to one step per 40px.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let sum = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (live.current.disabled) return;
      e.preventDefault();
      const dy = e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
      sum += dy;
      clearTimeout(idle);
      idle = setTimeout(() => {
        sum = 0;
      }, 200);
      while (Math.abs(sum) >= 40) {
        step.current(sum > 0 ? 1 : -1);
        sum -= Math.sign(sum) * 40;
      }
    };
    // the up and down arrows step it (and keep the list closed)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      step.current(e.key === 'ArrowUp' ? -1 : 1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
      clearTimeout(idle);
    };
  }, []);

  const prevAt = (at - 1 + n) % n;
  const nextAt = (at + 1) % n;
  const num = pad(at + 1, digits);
  const prevNum = pad(prevAt + 1, digits);
  const nextNum = pad(nextAt + 1, digits);
  const lower = label.toLowerCase();

  const engraved = legend ? (
    <span className="pk-engr" aria-hidden="true">
      {legend}
    </span>
  ) : null;

  return (
    <div ref={rootRef} className={cn('pk-counter', className)} style={style}>
      {legendSide === 'before' ? engraved : null}
      <span className="pk-counter-window">
        {digits > 0
          ? [...num].map((ch, k) => (
              <Drum
                key={k}
                value={ch}
                prev={n > 1 ? prevNum[k] : undefined}
                next={n > 1 ? nextNum[k] : undefined}
              />
            ))
          : null}
        {showName && n > 0 ? (
          <Drum
            name
            width={nameWidth}
            value={options[at].label}
            prev={n > 1 ? options[prevAt].label : undefined}
            next={n > 1 ? options[nextAt].label : undefined}
          />
        ) : null}
        <select
          id={id}
          aria-label={label}
          value={n > 0 ? options[at].value : ''}
          disabled={disabled}
          onChange={(e) => {
            setPhase((p) => !p);
            onChange(e.target.value);
          }}
        >
          {options.map((o, k) => (
            <option key={o.value} value={o.value}>
              {digits > 0 ? `${pad(k + 1, digits)} ` : ''}
              {o.label}
            </option>
          ))}
        </select>
      </span>
      <span className={cn('pk-wheel', phase && 'is-b')}>
        <button
          type="button"
          aria-label={`Previous ${lower}`}
          disabled={disabled}
          onClick={() => step.current(-1)}
        />
        <button
          type="button"
          aria-label={`Next ${lower}`}
          disabled={disabled}
          onClick={() => step.current(1)}
        />
      </span>
      {legendSide === 'after' ? engraved : null}
    </div>
  );
}
