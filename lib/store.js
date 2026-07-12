// lib/store.js — template storage. Postgres is the system of record
// (phase 4): one row per owner+name, seeded per owner from
// reference/starter-templates.json on first read. Templates are read at
// render time (job creation) and written from the Studio — both
// human-initiated, so touching Postgres here never keeps it awake.
//
// The old json-driver "read-only when hosted" limitation is gone:
// Postgres is writable everywhere (PGlite locally, Neon hosted).

import fs from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { template } from '../db/schema.js';
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
  let rows = await rowsFor(db, ownerId);
  if (!rows.length) {
    // First access for this owner: seed their starter set.
    const starters = JSON.parse(fs.readFileSync(STARTER_FILE, 'utf-8'));
    if (starters.length) {
      await db
        .insert(template)
        .values(
          starters.map(t => ({
            ownerId,
            name: t.name,
            template: t.template,
            data: t.data ?? null,
          })),
        )
        .onConflictDoNothing();
    }
    rows = await rowsFor(db, ownerId);
  }
  return rows.map(toEntry);
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
