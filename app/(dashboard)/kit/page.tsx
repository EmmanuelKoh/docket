// Kit (dev only): every part of the parts kit in every state it has, on
// one page in the dashboard shell, so a change to app/kit.css or
// components/hardware/kit/ shows on every part at once. /compare shows it
// (or any page) in both themes side by side. Production answers 404.
//
// Reads: the three newest printed jobs, for real paper on the slips.

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { type JobSummary, jobImageSrc } from '@/app/_lib/format';
import { jobsList } from '@/lib/ops/jobs.js';
import { KitSpecimen } from './kit-specimen';

export const metadata: Metadata = { title: 'Kit' };

export default async function KitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const caller = await getCaller();
  if (!caller?.ownerId) redirect('/login');
  const jobs = (await jobsList(caller, {
    limit: 3,
    status: ['done'],
  })) as JobSummary[];
  const prints = jobs.map((j) => ({
    src: jobImageSrc(j),
    name: j.name || 'Receipt',
    width: j.width || 576,
    height: j.height ?? 384,
  }));
  return <KitSpecimen prints={prints} />;
}
