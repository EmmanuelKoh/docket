// lib/store.js — template storage. Postgres is the system of record
// (phase 4): one row per owner+name. Reads never write: the starter set
// from reference/starter-templates.json is seeded once, when the account
// is created (the sign-up hook in lib/auth-server.js), and plugin
// templates on the Slips page view (lib/plugin-setup.js). Templates are
// read at render time (job creation) and written from the Studio — both
// human-initiated, so touching Postgres here never keeps it awake.
//
// The old json-driver "read-only when hosted" limitation is gone:
// Postgres is writable everywhere (PGlite locally, Neon hosted).

import fs from 'fs';
import path from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { template, user } from '../db/schema.js';
import { getDb } from './db.js';

const STARTER_FILE = path.join(process.cwd(), 'reference', 'starter-templates.json');

export function isReadOnly() {
  return false;
}

const toEntry = row => ({
  name: row.name,
  template: row.template,
  data: row.data ?? undefined,
  ownerId: row.ownerId,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
});

async function rowsFor(db, ownerId) {
  return db.select().from(template).where(eq(template.ownerId, ownerId));
}

export async function getTemplates(ownerId) {
  const db = await getDb();
  return (await rowsFor(db, ownerId)).map(toEntry);
}

// One template by name, or null.
export async function getTemplate(ownerId, name) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(template)
    .where(and(eq(template.ownerId, ownerId), eq(template.name, name)))
    .limit(1);
  return rows[0] ? toEntry(rows[0]) : null;
}

// The starter set, only for an owner with no templates at all: an owner
// who deleted every template stays empty. Returns how many were inserted.
export async function seedStarterTemplates(ownerId) {
  const db = await getDb();
  const any = await db
    .select({ name: template.name })
    .from(template)
    .where(eq(template.ownerId, ownerId))
    .limit(1);
  if (any.length) return 0;
  const starters = JSON.parse(fs.readFileSync(STARTER_FILE, 'utf-8'));
  if (!starters.length) return 0;
  const inserted = await db
    .insert(template)
    .values(
      starters.map(t => ({
        ownerId,
        name: t.name,
        template: t.template,
        data: t.data ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ name: template.name });
  return inserted.length;
}

// User ids with no template rows. Only scripts/seed-starters.js (one-off,
// for accounts created before the sign-up hook) uses it.
export async function usersWithoutTemplates() {
  const db = await getDb();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`not exists (select 1 from ${template} where ${template.ownerId} = ${user.id})`);
  return rows.map(r => r.id);
}

export async function saveTemplate(ownerId, { name, template: body, data }) {
  const db = await getDb();
  const values = {
    ownerId,
    name,
    template: body,
    data: data ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(template)
    .values(values)
    .onConflictDoUpdate({
      target: [template.ownerId, template.name],
      set: { template: body, data: data ?? null, updatedAt: new Date() },
    });
  return getTemplates(ownerId);
}

export async function deleteTemplate(ownerId, name) {
  const db = await getDb();
  await db
    .delete(template)
    .where(and(eq(template.ownerId, ownerId), eq(template.name, name)));
  return getTemplates(ownerId);
}
