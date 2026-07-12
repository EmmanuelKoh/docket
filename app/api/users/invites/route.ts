// /api/users/invites — mint and revoke invite links. Admin only (the
// legacy owner cookie counts as admin during the transition).

import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  requestSessionIdentity,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { invite } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';

const INVITE_DAYS = 7;

async function requireAdmin(req: Request) {
  const identity = await requestSessionIdentity(req);
  if (!identity) return { error: unauthorizedJson() };
  if (identity.role !== 'admin') {
    return {
      error: Response.json({ error: 'admins only' }, { status: 403 }),
    };
  }
  return { identity };
}

export async function POST(req: Request) {
  const { identity, error } = await requireAdmin(req);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const email =
    typeof body.email === 'string' && body.email.trim()
      ? body.email.trim()
      : null;

  const token = crypto.randomBytes(24).toString('base64url');
  const db = await getDb();
  await db.insert(invite).values({
    token,
    email,
    createdBy: identity.userId,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86400 * 1000),
  });
  return Response.json({ token });
}

export async function DELETE(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const token = new URL(req.url).searchParams.get('token') || '';
  const db = await getDb();
  await db.delete(invite).where(eq(invite.token, token));
  return Response.json({ ok: true });
}
