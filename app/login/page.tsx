// /login — same paper page, centered small card: DOCKET wordmark, email
// field, password field, one outline "Sign in" button. Nothing else on
// the page (spec).

import { redirect } from 'next/navigation';
import { sessionValid } from '../_lib/dashboard-session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await sessionValid()) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-xs rounded-md border-[0.5px] border-border bg-raised p-6">
        <div className="font-mono text-sm font-medium tracking-[0.14em]">
          DOCKET
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
