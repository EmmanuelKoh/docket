// Engraved lettering, cut into the plate and paint-filled (uppercase by
// CSS), the page name (the h1, engraved larger), and Note: text printed on
// the plate in sentence case, for hints and details that must be read.
// Classes in app/kit.css.

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/components/utils';

type EngravedTag = 'span' | 'p' | 'div' | 'label' | 'h2' | 'h3' | 'dt' | 'dd';

export function Engraved({
  as: Tag = 'span',
  tone,
  className,
  children,
  ...rest
}: {
  as?: EngravedTag;
  /** soft: the second line (a state, a sub-label); red: a failure. */
  tone?: 'soft' | 'red';
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cn(
        'pk-engr',
        tone === 'soft' && 'pk-engr--soft',
        tone === 'red' && 'pk-engr--red',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PageName({
  as: Tag = 'h1',
  className,
  children,
  ...rest
}: {
  as?: 'h1' | 'h2';
  children: ReactNode;
} & HTMLAttributes<HTMLHeadingElement>) {
  return (
    <Tag {...rest} className={cn('pk-name', className)}>
      {children}
    </Tag>
  );
}

export function Note({
  as: Tag = 'p',
  tone,
  className,
  children,
  ...rest
}: {
  as?: 'p' | 'span' | 'div';
  /** red: an error line (600 weight, the red fill). */
  tone?: 'red';
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cn('pk-note', tone === 'red' && 'pk-note--red', className)}
    >
      {children}
    </Tag>
  );
}
