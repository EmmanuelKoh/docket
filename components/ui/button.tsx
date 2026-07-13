import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/components/utils';

const buttonVariants = cva(
  // materials, not outlines (design-spec — material & type): a control
  // is ink, a key, or quiet text. Disabled is UNPRINTED — a dashed
  // placeholder where the control would print, no opacity dimming.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-none font-mono text-[13px] whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // committing KNOCKOUT: solid ink, paper text, the bite; hover
        // double-strikes (the platen hits twice), press nudges down
        default:
          'bite border border-ink bg-ink font-bold tracking-[0.02em] text-raised hover:[text-shadow:0.6px_0_currentColor] active:translate-y-px disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:font-normal disabled:tracking-normal disabled:text-ink-faint disabled:[text-shadow:none]',
        // the red knockout: failures and truly destructive commits only
        destructive:
          'bite border border-red bg-red font-bold tracking-[0.02em] text-white hover:[text-shadow:0.6px_0_currentColor] active:translate-y-px focus-visible:ring-destructive/20 disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:font-normal disabled:text-ink-faint disabled:[text-shadow:none]',
        // workbench REGISTER KEY: raised fill, ink edge, and a hard
        // SECOND-STRIKE offset (ink in both themes); hover lifts the
        // key, press sinks it flat
        outline:
          'border border-ink bg-raised text-ink shadow-[2px_2px_0_var(--key-shadow)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--key-shadow)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:text-ink-faint disabled:shadow-none',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        // quiet housekeeping: lowercase underlined text
        link: 'text-ink-muted underline underline-offset-2 hover:text-ink disabled:text-ink-faint disabled:no-underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
