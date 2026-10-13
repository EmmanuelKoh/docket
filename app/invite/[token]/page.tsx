// /invite/[token] — public invite-acceptance page. Valid token: the
// signup card (the before-hook in lib/auth-server.js re-validates and
// claims the token atomically at submit, so this page's check is only a
// courtesy). Invalid: a plain explanation, no form.

import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { invitesCheck } from '@/lib/ops/accounts.js';
import { InviteForm } from './invite-form';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const caller = await getCaller();
  if (caller) redirect('/');
  const { token } = await params;

  // Unknown, used and expired links are not_found; anything else is a real error.
  const found = await invitesCheck(caller, { token }).catch((err) => {
    if (err?.name === 'OpError' && err.code === 'not_found') return null;
    throw err;
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-xs rounded-md border-[0.5px] border-border bg-raised p-6">
        <div className="font-mono text-sm font-medium tracking-[0.14em]">
          DOCKET
        </div>
        {found ? (
          <InviteForm token={token} email={found.email} />
        ) : (
          <p className="mt-5 text-xs text-ink-faint">
            This invite link is invalid, already used, or expired. Ask the
            person who runs this docket for a new one.
          </p>
        )}
      </div>
    </main>
  );
}
