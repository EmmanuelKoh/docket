// /login — same paper page, centered small card: DOCKET wordmark, then
// the account form (email + password, Better Auth). A quiet toggle
// underneath switches to the legacy owner-password door, which stays
// until the accounts transition completes (spec: nothing else on the
// page).

import { redirect } from 'next/navigation';
import { sessionValid } from '../_lib/dashboard-session';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await sessionValid()) redirect('/');
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-xs rounded-md border-[0.5px] border-border bg-raised p-6">
        <div className="font-mono text-sm font-medium tracking-[0.14em]">
          DOCKET
        </div>
        <LoginForm legacyError={error} />
      </div>
    </main>
  );
}
