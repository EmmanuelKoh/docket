// Small text parts of the kit. Note: secondary text, 14px. Label: a small
// mono label printed on the panel, uppercase by CSS. ErrorText: a failure
// line in red, 14px. Units: keeps unit symbols (px, s, m, h, d) in lower
// case inside a legend that CSS prints in capitals ("576 × 274 px").

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/components/utils';

export function Note({
  as: Tag = 'p',
  className,
  children,
  ...rest
}: { as?: 'p' | 'span' | 'div' } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn('hw-note', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Label({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('hw-label', className)} {...rest}>
      {children}
    </span>
  );
}

export function ErrorText({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className={cn('hw-error', className)}>
      {children}
    </p>
  );
}

// A number, a space, then a unit symbol: "2 h", "576 × 274 px", "12 s"
const UNIT = /(\d) (px|ms|s|m|h|d)\b/g;

export function Units({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of children.matchAll(UNIT)) {
    const at = (m.index ?? 0) + m[1].length + 1;
    parts.push(children.slice(last, at));
    parts.push(
      <span key={at} className="hw-unit">
        {m[2]}
      </span>,
    );
    last = at + m[2].length;
  }
  if (!parts.length) return children;
  parts.push(children.slice(last));
  return <>{parts}</>;
}
