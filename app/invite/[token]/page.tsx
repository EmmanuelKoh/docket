// Create account from an invite link (design spec: pages, Login and
// Invite): the DOCKET wordmark printed on the ground and one module. A
// live link shows the sign-up form; the before-hook in
// lib/auth-server.js checks and uses up the token again at submit, so
// this page's check is only a courtesy. A dead link (unknown, used,
// expired or revoked) shows a note and no form. A signed-in visitor goes
// to Home.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { Module } from '@/components/hardware/module';
import { Note } from '@/components/hardware/text';
import { invitesCheck } from '@/lib/ops/accounts.js';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Create account' };

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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <h1 className="hw-wordmark hw-ink m-0 text-[48px]">DOCKET</h1>
      <Module
        number="01"
        title={found ? 'Create account' : 'Invite'}
        className="w-full max-w-[400px]"
      >
        {found ? (
          <InviteForm token={token} email={found.email} />
        ) : (
          <Note>
            This invite link does not work. It was used, it expired, or it was
            revoked. Ask an admin for a new link.
          </Note>
        )}
      </Module>
    </main>
  );
}
