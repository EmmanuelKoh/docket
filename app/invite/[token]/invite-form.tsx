'use client';

// Invite signup form: name, email (locked when the invite is pinned to
// one), password. Submits through Better Auth's client; the extra
// inviteToken field rides along in the body for the server's before-hook.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export function InviteForm({
  token,
  email,
}: {
  token: string;
  email: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signUp(form: FormData) {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      name: String(form.get('name') || ''),
      email: email || String(form.get('email') || ''),
      password: String(form.get('password') || ''),
      // Extra field read by the invite gate on the server.
      ...({ inviteToken: token } as Record<string, string>),
    });
    if (err) {
      setError(err.message || 'signup failed');
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
        signUp(new FormData(e.currentTarget));
      }}
    >
      <Input name="name" placeholder="name" autoFocus aria-label="Name" />
      <Input
        type="email"
        name="email"
        placeholder="email"
        defaultValue={email || ''}
        readOnly={!!email}
        aria-label="Email"
      />
      <Input
        type="password"
        name="password"
        placeholder="password (8+ characters)"
        aria-label="Password"
      />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
      {error ? <p className="text-xs text-red">{error}</p> : null}
    </form>
  );
}
