// Compare (dev only): one page of the app in light and dark at once, in
// two frames, at a chosen width. /compare?page=/queue&w=390. Both frames
// hot-reload with the dev server. Production answers 404.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CompareFrames } from './compare-frames';

export const metadata: Metadata = { title: 'Compare' };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; w?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { page, w } = await searchParams;
  return <CompareFrames page={page || '/kit'} width={Number(w) || 0} />;
}
