// /invite/[token] — public invite-acceptance page. Valid token: the
// signup card (the before-hook in lib/auth-server.js re-validates and
// claims the token atomically at submit, so this page's check is only a
// courtesy). Invalid: a plain explanation, no form.

import { and, eq, gt, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { sessionValid } from '@/app/_lib/dashboard-session';
import { invite } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { InviteForm } from './invite-form';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (await sessionValid()) redirect('/');
  const { token } = await params;

  const db = await getDb();
  const rows = await db
    .select({ email: invite.email })
    .from(invite)
    .where(
      and(
        eq(invite.token, token),
        isNull(invite.usedAt),
        gt(invite.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const found = rows[0];

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
