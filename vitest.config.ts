// vitest.config.ts — tests run against isolated local stores only.
// config.js loads .env through dotenv, which never overrides a variable
// that is already set, so every connection setting is pinned here (empty
// where it would reach a cloud service) before any module loads it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-test-'));
// The config loads in the main vitest process, so this runs once the whole
// run (or a watch session) ends and every worker has stopped writing.
process.on('exit', () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

export default defineConfig({
  resolve: {
    alias: { '@': root },
  },
  test: {
    include: ['tests/**/*.test.{js,mjs,ts}'],
    environment: 'node',
    // Refuses every network request except to this machine.
    setupFiles: ['tests/setup/no-network.ts'],
    // The first in-memory PGlite open per file (WASM load plus migrations)
    // can take longer than the 5s default when files run in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: '',
      PGLITE_DIR: 'memory://',
      DATA_DIR: dataDir,
      STORE_DRIVER: 'json',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      BLOB_READ_WRITE_TOKEN: '',
      GEMINI_API_KEY: '',
      DEVICE_TOKEN: 'test-device-token',
      OWNER_ID: 'test-owner',
      BETTER_AUTH_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
      SESSION_SECRET: '',
      AUTH_SECRET: '',
      BETTER_AUTH_SECRETS: '',
      DASHBOARD_PASSWORD: '',
      PRINT_SERVER: '',
      PRINTER_IP: '',
      VERCEL: '',
      VERCEL_GIT_COMMIT_SHA: '',
    },
  },
});
