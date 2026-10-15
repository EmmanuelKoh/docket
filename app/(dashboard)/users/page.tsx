// Users (design spec: pages, Users). Admin only: the Accounts module
// (each account's name and email, ADMIN on an admin) and the Invites
// module (each open invite link with its expiry date in the viewer's
// time zone, its Copy link and Revoke keys, then the form for a new
// one). One users.list read; the actions go through /api/users/invites
// (users-client.tsx). Other accounts get one note, not a 404: the key
// bank shows Users to admins only.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCaller } from '@/app/_lib/caller';
import { dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { Module } from '@/components/hardware/module';
import { PageTitle } from '@/components/hardware/page-title';
import { Row } from '@/components/hardware/row';
import { Label, Note } from '@/components/hardware/text';
import { usersList } from '@/lib/ops/accounts.js';
import { InviteRow, NewInviteForm } from './users-client';

export const metadata: Metadata = { title: 'Users' };

export const dynamic = 'force-dynamic';

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

export default async function UsersPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');
  if (caller.role !== 'admin') {
    return (
      <>
        <PageTitle>Users</PageTitle>
        <div className="max-w-[860px]">
          <Module number="01" title="Accounts">
            <Note>Only an admin can see accounts and make invites.</Note>
          </Module>
        </div>
      </>
    );
  }

  const [list, tz] = await Promise.all([usersList(caller), viewerTimeZone()]);
  const users: UserRow[] = list.users;
  const invites: InviteRowData[] = list.invites;
  const now = Date.now();

  return (
    <>
      <PageTitle>Users</PageTitle>
      <div className="flex max-w-[860px] flex-col gap-[30px]">
        <Module number="01" title="Accounts" flush>
          {users.map((u) => (
            <Row key={u.id} className="flex-wrap gap-x-4 gap-y-1">
              <span className="hw-row-text">
                <span className="hw-row-title break-words">{u.name}</span>
                <Note as="span" className="break-all">
                  {u.email}
                </Note>
              </span>
              {u.role === 'admin' ? <Label>Admin</Label> : null}
            </Row>
          ))}
          {users.length === 0 ? (
            <Row>
              <Note>No accounts yet. Make an invite below.</Note>
            </Row>
          ) : null}
        </Module>

        <Module number="02" title="Invites" flush>
          {invites.map((i) => (
            <InviteRow
              key={i.token}
              token={i.token}
              email={i.email}
              expires={dayLabel(i.expiresAt, tz, now)}
            />
          ))}
          {invites.length === 0 ? (
            <Row>
              <Note>No open invites.</Note>
            </Row>
          ) : null}
          <NewInviteForm />
        </Module>
      </div>
    </>
  );
}
