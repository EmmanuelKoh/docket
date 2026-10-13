// POST /api/slips/print-test?slug=X — queue a real print of the slip's
// primary template with its stored default data (slips.printTest). The
// cheap-probe path: the maintainer iterates on physical output, so every
// slip page can put paper through the printer in one click.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { slipsPrintTest } from '@/lib/ops/slips.js';

export const maxDuration = 60;

export async function POST(req: Request) {
  const caller = await requestCaller(req); // null -> the op answers 401 'sign in required'
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  return json(() => slipsPrintTest(caller, { slug }));
}
