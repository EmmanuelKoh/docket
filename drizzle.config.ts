// drizzle.config.ts — drizzle-kit CLI config (db:generate / db:migrate).
// generate diffs db/schema.js against db/migrations and writes new SQL;
// migrate applies pending migrations to DATABASE_URL (Neon). PGlite (local
// dev with no DATABASE_URL) applies migrations itself in lib/db.js.
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.js',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
