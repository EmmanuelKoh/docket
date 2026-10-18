'use client';

// The sign-in plates: email and password against Better Auth. The Sign in
// key stays down while the request runs. A refused sign-in shows a red
// line in the front plate, beside the key.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plate } from '@/components/hardware/kit/body';
import { Note } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
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
      // POST, so a submit before the script loads never puts the password
      // in the URL
      method="post"
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) signIn(new FormData(e.currentTarget));
      }}
    >
      <Plate seam className="flex flex-col gap-[22px] pt-[26px] pb-[28px]">
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
      </Plate>
      <Plate seam className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {error ? (
            <Note tone="red" role="alert">
              {error}
            </Note>
          ) : null}
          <span role="status" className="sr-only">
            {busy ? 'Signing in' : ''}
          </span>
        </div>
        <KeyWell>
          <Key legend="Sign in" type="submit" width={124} down={busy} />
        </KeyWell>
      </Plate>
    </form>
  );
}
