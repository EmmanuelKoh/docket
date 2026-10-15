'use client';

// The sign-up form of an invite: name, email (read-only when the invite
// is for one address) and password. It submits through Better Auth's
// client; the inviteToken field goes in the body for the server's
// before-hook. A refused sign-up shows a red line under the key.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field } from '@/components/hardware/field';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { authClient } from '@/lib/auth-client';

// "Password too short" -> "Password too short."
const sentence = (s: string) => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

export function InviteForm({
  token,
  email,
}: {
  token: string;
  email: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signUp(form: FormData) {
    setBusy(true);
    setError('');
    try {
      const { error: err } = await authClient.signUp.email({
        name: String(form.get('name') || ''),
        email: email || String(form.get('email') || ''),
        password: String(form.get('password') || ''),
        // Extra field read by the invite gate on the server.
        ...({ inviteToken: token } as Record<string, string>),
      });
      if (err) {
        setError(sentence(err.message || 'No account made. Try again'));
        setBusy(false);
        return;
      }
    } catch {
      setError('No connection. Try again.');
      setBusy(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        signUp(new FormData(e.currentTarget));
      }}
    >
      <Field label="Name" name="name" autoComplete="name" autoFocus required />
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        defaultValue={email || ''}
        readOnly={!!email}
        required
        spellCheck={false}
      />
      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters"
        minLength={8}
        required
      />
      <KeyGroup className="mt-2 flex">
        <PushKey type="submit" className="flex-1" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </PushKey>
      </KeyGroup>
      {error ? (
        <p role="alert" className="hw-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
