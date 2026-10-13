// lib/accounts.js: who has an account, and the invite links that make new
// ones. Better Auth owns the user rows (lib/auth-server.js creates them);
// this module only lists them. Invites are ours: signup is invite-only, and
// the sign-up before-hook in lib/auth-server.js claims a row atomically
// (used_at), so a link is "open" while unused and unexpired. Every call here
// is an admin's dashboard action or the invite page, never the device path.

import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { invite, user } from '../db/schema.js';
import { getDb } from './db.js';

const INVITE_TTL_MS = 7 * 86400 * 1000;

const isOpen = now => and(isNull(invite.usedAt), gt(invite.expiresAt, now));

// Every account, newest first. Dates are Date objects.
export async function listAccounts() {
  const db = await getDb();
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));
}

// Invites still usable (unused, unexpired), newest first.
export async function listOpenInvites() {
  const db = await getDb();
  return db
    .select({ token: invite.token, email: invite.email, expiresAt: invite.expiresAt })
    .from(invite)
    .where(isOpen(new Date()))
    .orderBy(desc(invite.createdAt));
}

// Mint an invite link token, valid for 7 days. email (or null) pins the
// invite to one address; createdBy records who minted it.
export async function createInvite({ email = null, createdBy }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const db = await getDb();
  await db.insert(invite).values({ token, email, createdBy, expiresAt });
  return { token, expiresAt };
}

// Delete an invite, used or not. True when a row went.
export async function deleteInvite(token) {
  const db = await getDb();
  const rows = await db
    .delete(invite)
    .where(eq(invite.token, token))
    .returning({ token: invite.token });
  return rows.length > 0;
}

// The open invite with this token ({ email }), or null when it is unknown,
// used or expired. A courtesy check: the sign-up hook re-validates.
export async function findOpenInvite(token) {
  const db = await getDb();
  const rows = await db
    .select({ email: invite.email })
    .from(invite)
    .where(and(eq(invite.token, token), isOpen(new Date())))
    .limit(1);
  return rows[0] ?? null;
}
