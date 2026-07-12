// /users — admin-only: who has an account, and open invite links.
// Reads Postgres directly (server component); create/revoke actions go
// through /api/users/invites. Non-admins get a quiet note, not a 404,
// so the page can stay linked in the sidebar for admins only.

import { and, desc, gt, isNull } from 'drizzle-orm';
import { getSessionIdentity } from '@/app/_lib/dashboard-session';
import { invite, user } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { InviteRow, NewInviteForm } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const identity = await getSessionIdentity();
  if (!identity || identity.role !== 'admin') {
    return (
      <p className="text-xs text-ink-faint">
        Accounts are managed by the owner of this docket.
      </p>
    );
  }

  type UserRow = {
    id: string;
    name: string;
    email: string;
    role: string | null;
    createdAt: Date;
  };
  type InviteRowData = { token: string; email: string | null; expiresAt: Date };

  const db = await getDb();
  const users: UserRow[] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));
  const invites: InviteRowData[] = await db
    .select({
      token: invite.token,
      email: invite.email,
      expiresAt: invite.expiresAt,
    })
    .from(invite)
    .where(and(isNull(invite.usedAt), gt(invite.expiresAt, new Date())))
    .orderBy(desc(invite.createdAt));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[13px] font-semibold text-ink">Accounts</h2>
        <ul className="mt-3">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-baseline gap-2 border-b-[0.5px] border-border py-2"
            >
              <span className="text-sm font-medium text-ink">{u.name}</span>
              <span className="leader" aria-hidden />
              <span className="text-xs text-ink-faint">
                {u.email}
                {u.role === 'admin' ? ' · admin' : ''}
              </span>
            </li>
          ))}
          {users.length === 0 ? (
            <li className="py-2 text-xs text-ink-faint">
              No accounts yet — you are signed in through the legacy owner
              password. Create your own account with an invite below, or
              scripts/create-user.js.
            </li>
          ) : null}
        </ul>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-ink">Invites</h2>
        <ul className="mt-3">
          {invites.map((i) => (
            <InviteRow
              key={i.token}
              token={i.token}
              email={i.email}
              expiresAt={i.expiresAt.toISOString()}
            />
          ))}
          {invites.length === 0 ? (
            <li className="py-2 text-xs text-ink-faint">No open invites.</li>
          ) : null}
        </ul>
        <div className="mt-4">
          <NewInviteForm />
        </div>
      </section>
    </div>
  );
}
