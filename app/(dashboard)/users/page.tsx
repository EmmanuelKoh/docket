// /users — admin-only: who has an account, and open invite links
// (users.list in lib/ops/accounts.js); create/revoke actions go through
// /api/users/invites. Non-admins get a quiet note, not a 404, so the page
// can stay linked in the sidebar for admins only.

import { getCaller } from '@/app/_lib/caller';
import { usersList } from '@/lib/ops/accounts.js';
import { InviteRow, NewInviteForm } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const caller = await getCaller();
  if (caller?.role !== 'admin') {
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
    createdAt: string;
  };
  type InviteRowData = {
    token: string;
    email: string | null;
    expiresAt: string;
  };
  const list = await usersList(caller);
  const users: UserRow[] = list.users;
  const invites: InviteRowData[] = list.invites;

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
              No accounts yet. Create one with an invite below.
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
              expiresAt={i.expiresAt}
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
