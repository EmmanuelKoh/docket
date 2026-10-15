// Fader: a range input drawn as a slot cut into the panel, with the slide
// switch's ribbed cap riding in it and a printed scale (a tick at each
// end of the cap's travel). `centered` adds a longer tick at the middle,
// for a fader whose zero is in the middle. Every native input prop passes
// through, so a page can keep its own ids for code that reads them.

import type { InputHTMLAttributes } from 'react';
import { cn } from '@/components/utils';

export function Fader({
  centered = false,
  className,
  ...rest
}: { centered?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>) {
  return (
    <input
      type="range"
      {...rest}
      className={cn('hw-fader', centered && 'hw-fader--centered', className)}
    />
  );
}
