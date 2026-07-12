// lib/auth-client.ts — the browser side of Better Auth: React hooks and
// fetch wrappers that talk to /api/auth/*. Client components import from
// here; server code uses lib/auth-server.js.

import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [adminClient()],
});
