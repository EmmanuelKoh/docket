'use client';

// The sign-in form: email and password against Better Auth. A refused
// sign-in shows a red line under the key.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field } from '@/components/hardware/field';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { authClient } from '@/lib/auth-client';

// "Invalid email or password" -> "Invalid email or password."
const sentence = (s: string) => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(form: FormData) {
    setBusy(true);
    setError('');
    try {
      const { error: err } = await authClient.signIn.email({
        email: String(form.get('email') || ''),
        password: String(form.get('password') || ''),
      });
      if (err) {
        setError(sentence(err.message || 'Not signed in. Try again'));
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
        signIn(new FormData(e.currentTarget));
      }}
    >
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        autoFocus
        required
        spellCheck={false}
      />
      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
      />
      <KeyGroup className="mt-2 flex">
        <PushKey type="submit" className="flex-1" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
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
