// lib/ops/accounts.js: the Users page's operations, plus the invite page's
// check. Admins list accounts and open invites, mint and revoke invite
// links, and create accounts directly (scripts/create-user.js bootstraps
// the first admin). Anyone holding a link may check it. Storage is
// lib/accounts.js; Better Auth (lib/auth-server.js) creates the user rows,
// and its sign-up hook claims an invite at submit.
import { z } from 'zod';
import * as accounts from '../accounts.js';
import { getAuth } from '../auth-server.js';
import { defineOperation, OpError } from './define.js';

const required = msg => z.string({ error: msg }).min(1, { error: msg });

export const usersList = defineOperation({
  name: 'users.list',
  description: 'Every account (name, email, role, created) and the invite links still open, newest first.',
  permission: 'admin',
  effects: ['db.read'],
  input: z.object({}),
  async run() {
    const [users, invites] = await Promise.all([accounts.listAccounts(), accounts.listOpenInvites()]);
    return {
      users: users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })),
      invites: invites.map(i => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
    };
  },
});

export const usersCreate = defineOperation({
  name: 'users.create',
  description: 'Create an account without an invite. It gets the starter templates like any new account.',
  permission: 'admin',
  effects: ['db.write'],
  input: z.object({
    name: required('name required'),
    email: required('email required'),
    password: z.string({ error: 'password required' }).min(8, { error: 'password must be at least 8 characters' }),
    role: z.enum(['admin', 'user']).default('user'),
  }),
  async run(_caller, { name, email, password, role }) {
    const auth = await getAuth();
    try {
      // Server-side createUser skips the invite gate (it guards /sign-up/email only).
      const { user } = await auth.api.createUser({ body: { name, email, password, role } });
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role ?? role } };
    } catch (err) {
      if (err?.name !== 'APIError' || err.statusCode !== 400) throw err;
      const taken = err.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL';
      throw new OpError(taken ? 'conflict' : 'invalid', err.body?.message || err.message);
    }
  },
});

export const invitesCreate = defineOperation({
  name: 'invites.create',
  description: 'Mint an invite link token, valid for 7 days. An email pins it to that address; without one, anyone with the link can sign up.',
  permission: 'admin',
  effects: ['db.write'],
  input: z.object({ email: z.string().nullish().catch(null) }), // blank or not a string = unpinned
  async run(caller, { email }) {
    const { token } = await accounts.createInvite({ email: email?.trim() || null, createdBy: caller.actor.id });
    return { token };
  },
});

export const invitesRevoke = defineOperation({
  name: 'invites.revoke',
  description: 'Delete an invite link so it can no longer be used.',
  permission: 'admin',
  effects: ['db.write'],
  destructive: true,
  input: z.object({ token: required('token query parameter is required') }),
  async run(_caller, { token }) {
    await accounts.deleteInvite(token); // already gone counts as done
    return { ok: true };
  },
});

export const invitesCheck = defineOperation({
  name: 'invites.check',
  description: 'Check an invite link before signing up: its pinned email (or null), if it is unused and unexpired.',
  permission: 'public',
  effects: ['db.read'],
  input: z.object({ token: required('token required') }),
  async run(_caller, { token }) {
    const found = await accounts.findOpenInvite(token);
    if (!found) throw new OpError('not_found', 'invite is invalid, already used, or expired');
    return { email: found.email };
  },
});
