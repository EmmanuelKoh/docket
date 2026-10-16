// Users (design spec: pages, Users). Admin only: one body. The top plate
// holds the engraved page name and the printer's lamp; plate 01 lists the
// accounts (each name engraved over its email, Admin at the right for an
// admin); plate 02 lists the open invite links (who can use each one and
// its expiry date in the viewer's time zone, with Copy link and Revoke
// keys); plate 03 makes a new one. One users.list read; the lamp shares
// the nav's printer read (React cache). The actions go
// through /api/users/invites (users-client.tsx). Other accounts get one
// note, not a 404: the nav shows Users to admins only.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getCaller } from '@/app/_lib/caller';
import {
  type PrinterSummary,
  printerStateText,
  printerSummary,
} from '@/app/_lib/printer-data';
import { dayLabel, viewerTimeZone } from '@/app/_lib/time';
import { Body, Plate } from '@/components/hardware/kit/body';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Lamp } from '@/components/hardware/kit/led';
import { Row, Rows } from '@/components/hardware/kit/sheet';
import { usersList } from '@/lib/ops/accounts.js';
import { InviteRow, NewInviteForm } from './users-client';
import { UsersPlate } from './users-plate';

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

/** The printer's lamp in the top plate, as the nav shows it. */
function lampFor(p: PrinterSummary | null) {
  return p?.name ? (
    <Lamp state={p.state}>{printerStateText(p.state)}</Lamp>
  ) : null;
}

function UsersBody({
  lamp,
  children,
}: {
  lamp: ReactNode;
  children: ReactNode;
}) {
  return (
    <Body as="section" aria-labelledby="users-name">
      <Plate head>
        <PageName id="users-name">Users</PageName>
        {lamp}
      </Plate>
      {children}
    </Body>
  );
}

export default async function UsersPage() {
  const caller = await getCaller();
  if (!caller) redirect('/login');

  // The lamp is the shell's printer read, shared; a failed read shows none.
  const printer = printerSummary(caller).catch(() => null);

  if (caller.role !== 'admin') {
    return (
      <UsersBody lamp={lampFor(await printer)}>
        <UsersPlate id="users-accounts" number="01" title="Accounts">
          <Note className="pt-3 min-[1180px]:pt-[10px]">
            Only an admin can see accounts and make invites.
          </Note>
        </UsersPlate>
      </UsersBody>
    );
  }

  const [list, tz, p] = await Promise.all([
    usersList(caller),
    viewerTimeZone(),
    printer,
  ]);
  const users: UserRow[] = list.users;
  const invites: InviteRowData[] = list.invites;
  const now = Date.now();

  return (
    <UsersBody lamp={lampFor(p)}>
      <UsersPlate
        id="users-accounts"
        number="01"
        title="Accounts"
        className="pb-[12px]"
      >
        <Rows ruled>
          {users.map((u) => (
            <Row key={u.id} className="gap-x-6">
              <span className="pk-row-text">
                <span className="pk-engr break-words leading-[1.25]">
                  {u.name}
                </span>
                <Note as="span" className="[overflow-wrap:anywhere]">
                  {u.email}
                </Note>
              </span>
              {u.role === 'admin' ? (
                <Engraved tone="soft">Admin</Engraved>
              ) : null}
            </Row>
          ))}
          {users.length === 0 ? (
            <Row>
              <Note>No accounts yet. Make an invite below.</Note>
            </Row>
          ) : null}
        </Rows>
      </UsersPlate>

      <UsersPlate
        id="users-invites"
        number="02"
        title="Invites"
        className="pb-[12px]"
      >
        <Rows ruled>
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
        </Rows>
      </UsersPlate>

      <NewInviteForm />
    </UsersBody>
  );
}
