// /login — same paper page, centered small card: DOCKET wordmark, password
// field, one outline "Sign in" button. Nothing else on the page (spec).

import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sessionValid } from '../_lib/dashboard-session';

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
        <form action="/login/submit" method="post" className="mt-5 space-y-3">
          <Input
            type="password"
            name="password"
            placeholder="password"
            autoFocus
            aria-label="Password"
          />
          <Button type="submit" variant="outline" className="w-full">
            Sign in
          </Button>
        </form>
        {error ? <p className="mt-3 text-xs text-red">{error}</p> : null}
      </div>
    </main>
  );
}
