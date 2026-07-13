'use client';

// The login card's form: email + password against Better Auth.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(form: FormData) {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({
      email: String(form.get('email') || ''),
      password: String(form.get('password') || ''),
    });
    if (err) {
      setError(err.message || 'sign in failed');
      setBusy(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        signIn(new FormData(e.currentTarget));
      }}
    >
      <Input
        type="email"
        name="email"
        placeholder="email"
        autoFocus
        aria-label="Email"
      />
      <Input
        type="password"
        name="password"
        placeholder="password"
        aria-label="Password"
      />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      {error ? <p className="text-xs text-red">{error}</p> : null}
    </form>
  );
}
