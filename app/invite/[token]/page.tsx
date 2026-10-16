// Create account from an invite link (design spec: pages, Login and
// Invite): the same unit as Login. A live link shows the sign-up plates;
// the before-hook in lib/auth-server.js checks and uses up the token again
// at submit, so this page's check is only a courtesy. A dead link
// (unknown, used, expired or revoked) lights the red lamp and shows a note
// and no form. A signed-in visitor goes to Home.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { AuthUnit } from '@/components/auth-unit';
import { Plate } from '@/components/hardware/kit/body';
import { Note } from '@/components/hardware/kit/engraved';
import { invitesCheck } from '@/lib/ops/accounts.js';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Invite' };

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

  if (!found) {
    return (
      <AuthUnit title="Invite" dead>
        <Plate seam className="pt-[26px] pb-[28px]">
          <Note>
            This invite link does not work. It was used, it expired, or it was
            revoked. Ask an admin for a new link.
          </Note>
        </Plate>
      </AuthUnit>
    );
  }

  return (
    <AuthUnit title="Create account">
      <InviteForm token={token} email={found.email} />
    </AuthUnit>
  );
}
