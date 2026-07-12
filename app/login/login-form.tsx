'use client';

// The login card's form. Two doors during the accounts transition:
//   account — email + password against Better Auth (/api/auth/*)
//   owner   — the legacy single password, posted to /login/submit,
//             which sets the old HMAC cookie (removed in the last
//             accounts phase)

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function LoginForm({ legacyError }: { legacyError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'account' | 'owner'>(
    legacyError ? 'owner' : 'account',
  );
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
    <div className="mt-5">
      {mode === 'account' ? (
        <form
          className="space-y-3"
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
          <Button
            type="submit"
            variant="outline"
            className="w-full"
            disabled={busy}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      ) : (
        <form action="/login/submit" method="post" className="space-y-3">
          <Input
            type="password"
            name="password"
            placeholder="owner password"
            autoFocus
            aria-label="Owner password"
          />
          <Button type="submit" variant="outline" className="w-full">
            Sign in
          </Button>
        </form>
      )}
      {error || (mode === 'owner' && legacyError) ? (
        <p className="mt-3 text-xs text-red">
          {mode === 'owner' ? legacyError || error : error}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-4 text-xs text-ink-faint transition-colors hover:text-ink"
        onClick={() => {
          setMode(mode === 'account' ? 'owner' : 'account');
          setError(null);
        }}
      >
        {mode === 'account' ? 'use owner password' : 'use an account'}
      </button>
    </div>
  );
}
