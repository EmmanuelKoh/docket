'use client';

// The sign-up plates of an invite: name, email (read-only when the invite
// is for one address) and password. It submits through Better Auth's
// client; the inviteToken field goes in the body for the server's
// before-hook. The Create account key stays down while the request runs.
// A refused sign-up shows a red line in the front plate, beside the key.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plate } from '@/components/hardware/kit/body';
import { Note } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
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
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) signUp(new FormData(e.currentTarget));
      }}
    >
      <Plate seam className="flex flex-col gap-[22px] pt-[26px] pb-[28px]">
        <Field
          label="Name"
          name="name"
          autoComplete="name"
          autoFocus
          required
        />
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
      </Plate>
      <Plate seam className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {error ? (
            <Note tone="red" role="alert">
              {error}
            </Note>
          ) : null}
          <span role="status" className="sr-only">
            {busy ? 'Creating account' : ''}
          </span>
        </div>
        <KeyWell>
          <Key legend="Create account" type="submit" width={164} down={busy} />
        </KeyWell>
      </Plate>
    </form>
  );
}
