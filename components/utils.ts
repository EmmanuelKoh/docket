// components/utils.ts — the shadcn `cn` helper (class merge). Lives here
// instead of lib/ because lib/ is reserved for the store facades.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
