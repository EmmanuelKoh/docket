// tests/helpers/fake-auth.ts — stands in for lib/auth-server.js in route
// tests: vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth')).
// The session is the `x-test-user: <id>:<role>` request header; no header
// means signed out.

export async function getAuth() {
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const v = headers.get('x-test-user');
        if (!v) return null;
        const [id, role = 'user'] = v.split(':');
        return { user: { id, role } };
      },
    },
  };
}
